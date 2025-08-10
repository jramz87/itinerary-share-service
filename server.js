const express = require('express');
const cors = require('cors');
const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3004;

// setup Resend
let resend;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
}

// get itinerary from main backend endpoint
async function getItineraryFromMain(itineraryId) {
    try {
        const response = await fetch(`http://localhost:3001/api/itineraries`);
        if (!response.ok) {
            throw new Error('Failed to fetch from main backend');
        }
        const itineraries = await response.json();
        return itineraries.find(i => i.id === itineraryId);
    } catch (error) {
        console.error('Error fetching from main backend:', error);
        throw error;
    }
}

app.use(cors());
app.use(express.json());

// validate required itinerary fields
function validateItinerary(itinerary) {
    const required = ['tripTitle', 'destination', 'startDate', 'endDate', 'clientName'];
    const missing = [];
    
    for (let field of required) {
        if (!itinerary[field] || itinerary[field].toString().trim() === '') {
            missing.push(field);
        }
    }
    
    return {
        isValid: missing.length === 0,
        missingFields: missing
    };
}

// generate email template with complete itinerary data
function generateEmailTemplate(itinerary, customMessage = '') {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Travel Itinerary</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; }
            .header { background: #0081A7; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; }
            .trip-details { background: #FDFCDC; padding: 15px; border-radius: 8px; margin: 15px 0; }
            .daily-plan { background: #FED9B7; padding: 12px; border-radius: 6px; margin: 10px 0; border-left: 4px solid #0081A7; }
            .detail-row { margin: 8px 0; }
            .label { font-weight: bold; color: #0081A7; }
            .custom-message { background: #FED9B7; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #F07167; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            .day-header { color: #0081A7; font-weight: bold; margin-bottom: 5px; }
            .weather { color: #666; font-size: 14px; margin-bottom: 5px; }
            .activities { margin-top: 8px; }
            @media only screen and (max-width: 480px) {
                body { padding: 10px; }
                .content { padding: 15px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Your Travel Itinerary</h1>
                <p>Prepared with care for your upcoming adventure</p>
            </div>
            
            <div class="content">
                <p>Dear ${itinerary.clientName?.split(' ')[0] || 'Traveler'},</p>
                
                ${customMessage ? `
                <div class="custom-message">
                    <p><strong>Personal Message:</strong></p>
                    <p>${customMessage}</p>
                </div>
                ` : ''}
                
                <p>Here are the complete details for your upcoming trip:</p>
                
                <div class="trip-details">
                    <h2 style="color: #0081A7; margin-top: 0;">${itinerary.tripTitle || 'Your Trip'}</h2>
                    
                    <div class="detail-row">
                        <span class="label">Client:</span> ${itinerary.clientName || 'N/A'}
                    </div>
                    
                    <div class="detail-row">
                        <span class="label">Destination:</span> ${itinerary.destination || 'N/A'}
                    </div>
                    
                    <div class="detail-row">
                        <span class="label">Travel Dates:</span> ${itinerary.startDate || 'TBD'} to ${itinerary.endDate || 'TBD'}
                    </div>
                    
                    <div class="detail-row">
                        <span class="label">Number of Travelers:</span> ${itinerary.numberOfTravelers || 'N/A'}
                    </div>
                    
                    <div class="detail-row">
                        <span class="label">Trip Type:</span> ${itinerary.tripType || 'N/A'}
                    </div>
                    
                    ${itinerary.status ? `
                    <div class="detail-row">
                        <span class="label">Status:</span> ${itinerary.status}
                    </div>
                    ` : ''}
                    
                    <div class="detail-row">
                        <span class="label">Itinerary ID:</span> ${itinerary.id}
                    </div>
                </div>
                
                ${itinerary.notes ? `
                <div class="trip-details">
                    <h3 style="color: #0081A7;">Notes:</h3>
                    <p>${itinerary.notes}</p>
                </div>
                ` : ''}
                
                ${itinerary.dailyPlans && itinerary.dailyPlans.length > 0 ? `
                <div class="trip-details">
                    <h3 style="color: #0081A7;">Daily Itinerary:</h3>
                    ${itinerary.dailyPlans.map((day, index) => `
                        <div class="daily-plan">
                            <div class="day-header">Day ${index + 1} - ${day.date}</div>
                            ${day.weather ? `<div class="weather">Weather: ${day.weather}</div>` : ''}
                            ${day.activities ? `
                                <div class="activities">
                                    <strong>Activities:</strong><br>
                                    ${day.activities}
                                </div>
                            ` : '<div class="activities"><em>No activities planned yet</em></div>'}
                        </div>
                    `).join('')}
                </div>
                ` : ''}
                
                <p>If you have any questions or would like to make changes, please don't hesitate to reach out on our Contact page!</p>
                
                <p>Best regards,<br>Your Travel Agent</p>
            </div>
            
            <div class="footer">
                <p>This itinerary was sent on ${new Date().toLocaleDateString()}</p>
                <p>Itinerary ID: ${itinerary.id}</p>
            </div>
        </div>
    </body>
    </html>
    `;
    
    return html;
}

// save itinerary endpoint (User Story 1) - forwards to main backend
app.post('/api/save-itinerary', async (req, res) => {
    try {
        const itinerary = req.body;
        
        // validate required fields
        const validation = validateItinerary(itinerary);
        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Missing required fields',
                missingFields: validation.missingFields,
                message: `Please provide: ${validation.missingFields.join(', ')}`
            });
        }
        
        // forward to main backend
        const response = await fetch('http://localhost:3001/api/itineraries', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(itinerary)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save to main backend');
        }
        
        const savedItinerary = await response.json();
        
        res.json({
            success: true,
            message: 'Itinerary saved successfully',
            itinerary: savedItinerary
        });
        
    } catch (error) {
        console.error('Save itinerary error:', error);
        res.status(500).json({
            error: 'Failed to save itinerary',
            message: error.message
        });
    }
});

// share itinerary by email endpoint (User Story 2)
app.post('/api/share-itinerary', async (req, res) => {
    try {
        const { itineraryId, email, customMessage } = req.body;
        
        if (!itineraryId || !email) {
            return res.status(400).json({
                error: 'Missing required fields: itineraryId and email'
            });
        }
        
        // validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                error: 'Invalid email format'
            });
        }
        
        // get itinerary from main backend
        const itinerary = await getItineraryFromMain(itineraryId);
        if (!itinerary) {
            return res.status(404).json({ error: 'Itinerary not found' });
        }
        
        // validate itinerary has required fields
        const validation = validateItinerary(itinerary);
        if (!validation.isValid) {
            return res.status(400).json({
                error: 'Itinerary is incomplete',
                missingFields: validation.missingFields
            });
        }
        
        // generate email content
        const emailHtml = generateEmailTemplate(itinerary, customMessage);
        
        // send email using Resend
        if (!resend) {
            return res.status(500).json({ error: 'Email service not configured' });
        }

        await resend.emails.send({
            from: process.env.FROM_EMAIL || 'onboarding@resend.dev',
            to: email,
            subject: `Your ${itinerary.tripTitle} Itinerary`,
            html: emailHtml
        });
        
        console.log(`Itinerary email sent to ${email} for trip: ${itinerary.tripTitle}`);
        
        res.json({
            success: true,
            message: `Itinerary sent to ${email}`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Share itinerary error:', error);
        res.status(500).json({
            error: 'Failed to send email',
            message: error.message
        });
    }
});

// get itineraries endpoint - fetches from main backend
app.get('/api/itineraries', async (req, res) => {
    try {
        const response = await fetch('http://localhost:3001/api/itineraries');
        if (!response.ok) {
            throw new Error('Failed to fetch from main backend');
        }
        const itineraries = await response.json();
        res.json(itineraries);
    } catch (error) {
        console.error('Get itineraries error:', error);
        res.status(500).json({ error: 'Failed to load itineraries' });
    }
});

// health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        service: 'itinerary-share',
        emailConfigured: !!resend
    });
});

app.listen(PORT, () => {
    console.log(`Itinerary share service running on http://localhost:${PORT}`);
});