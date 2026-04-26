const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require("openai");
const Stripe = require('stripe');

dotenv.config();

const app = express();

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Stripe setup
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-04-22.dahlia' });

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());


// Stripe Checkout Route
app.post('/api/checkout', async (req, res) => {
  try {
    const { planId, planName, price } = req.body;

    if (!planId || !planName || !price) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${planName} - Music Promotion Campaign`,
              description: `Upgrade to ${planName} tier`,
            },
            unit_amount: price * 100,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/?success`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?cancele`,
      customer_email: req.body.email || undefined,
    });

    return res.json({ sessionId: session.id });

  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({
      error: 'Checkout failed',
      details: error.message,
    });
  }
});

// Mail transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODE_MAILER_USER,
    pass: process.env.NODE_MAILER_PASS,
  },
});


// 🔥 Generate strategy (CLEAN + SHORT OUTPUT)
async function generateStrategy(data) {
  const prompt = `
You are a senior music marketing strategist working for a premium agency.

Create a SHORT, CLIENT-READY marketing strategy.

Rules:
- No mention of AI or generation
- Very concise and actionable
- Max 12–15 lines total per section
- Use bullet points only when necessary
- No long paragraphs

Format exactly:

Strategy Overview:
explain in short paragraph max 4 to 5 lines also mention our maketing company might media can help in this strategy

INPUT:
Platforms: ${data.platforms.join(", ")}
Goal: ${data.goal}
Budget: ${data.budget}
Duration: ${data.duration}
Genre: ${data.genre}
Listeners: ${data.listeners}

output format
Return response in STRICT JSON format:

{
  "overview": "string (short paragraph)",
  "bullets": ["point 1", "point 2", "point 3"]
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a senior music marketing strategist."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
  });

  // return response.choices[0].message.content;
  const parsed = JSON.parse(response.choices[0].message.content);
  return parsed
}


// 🔥 Format for mobile-friendly email
function formatStrategy(text) {
  return text
    .split("\n")
    .map(line => {
      if (!line.trim()) return "";
      return `
        <p style="
          margin:6px 0;
          line-height:1.5;
          font-size:14px;
          color:#eaeaea;
        ">
          ${line}
        </p>
      `;
    })
    .join("");
}


// 📩 Route
app.post('/api/post/email/sendMailToBrandBlitz', async (req, res) => {
  try {
    const { platforms, goal, budget, duration, genre, listeners, email } = req.body;

    // Validation
    if (!platforms || !goal || !budget || !duration || !genre || !listeners || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 🔥 Generate strategy
    const strategy = await generateStrategy({
      platforms,
      goal,
      budget,
      duration,
      genre,
      listeners,
    });

    const mailOptions = {
      from: process.env.NODE_MAILER_USER,
      to: 'zainyshorts@gmail.com',
      subject: `New Promo Form Submission - ${platforms.join(', ')}`,
      html: `
        <div style="
          font-family: Arial;
          background:#0f0f23;
          color:#fff;
          padding:20px;
        ">
          <div style="
            max-width:600px;
            margin:auto;
            border:1px solid #ff6b35;
            border-radius:12px;
            padding:20px;
            background:#1a1a2e;
          ">

            <h2 style="
              color:#ff6b35;
              text-align:center;
              font-size:18px;
              margin-bottom:15px;
            ">
              🎵 Music Promo Strategy Report
            </h2>

            <div style="font-size:13px; margin-bottom:15px;">
              <p><b>Platforms:</b> ${platforms.join(', ')}</p>
              <p><b>Goal:</b> ${goal}</p>
              <p><b>Budget:</b> ${budget}</p>
              <p><b>Duration:</b> ${duration}</p>
              <p><b>Genre:</b> ${genre}</p>
              <p><b>Listeners:</b> ${listeners}</p>
              <p><b>Email:</b> ${email}</p>
            </div>

            <hr style="border-color:#333; margin:15px 0;" />

            <div>
              <h3>Strategy Overview</h3>
              <p>${strategy.overview}</p>

              <ul>
                ${strategy.bullets.map(b => `<li>${b}</li>`).join("")}
              </ul>
                          </div>

            <p style="
              font-size:11px;
              color:#777;
              margin-top:20px;
              text-align:center;
            ">
              Generated on ${new Date().toLocaleString()}
            </p>

          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.json({
      success: true,
      message: 'Email sent successfully with AI strategy',
    });

  } catch (error) {
    console.error('Email error:', error);
    return res.status(500).json({
      error: 'Failed to send email',
      details: error.message,
    });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});