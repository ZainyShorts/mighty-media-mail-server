const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require("openai");
// const mongoose = require('mongoose');

dotenv.config();

const app = express();

// ======================
// MongoDB (Vercel safe)
// ======================
// let cached = global.mongoose;

// if (!cached) {
//   cached = global.mongoose = { conn: null, promise: null };
// }

// async function connectDB() {
//   if (cached.conn) return cached.conn;

//   if (!cached.promise) {
//     cached.promise = mongoose.connect(process.env.MONGO_URI).then((mongoose) => {
//       return mongoose;
//     });
//   }

//   cached.conn = await cached.promise;
//   return cached.conn;
// }

// connectDB();

// ======================
// Schema
// ======================
// const strategySchema = new mongoose.Schema({
//   platforms: [String],
//   goal: String,
//   budget: String,
//   duration: String,
//   genre: String,
//   listeners: String,
//   email: String,
//   strategy: {
//     overview: String,
//     bullets: [String]
//   },
//   createdAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// const Strategy = mongoose.model("Strategy", strategySchema);

// ======================
// OpenAI
// ======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ======================
// Middleware
// ======================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ======================
// Email Transporter
// ======================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODE_MAILER_USER,
    pass: process.env.NODE_MAILER_PASS,
  },
});

// ======================
// AI Strategy Generator
// ======================
async function generateStrategy(data) {
  const prompt = `
You are a senior music marketing strategist.

Create a SHORT marketing strategy.

Rules:
- No AI mention
- Max 12–15 lines
- Very concise

INPUT:
Platforms: ${data.platforms.join(", ")}
Goal: ${data.goal}
Budget: ${data.budget}
Duration: ${data.duration}
Genre: ${data.genre}
Listeners: ${data.listeners}

Return STRICT JSON:
{
  "overview": "short paragraph",
  "bullets": ["point 1", "point 2", "point 3"]
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a music marketing strategist." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
  });

  let parsed;

  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch (err) {
    console.log("JSON parse failed, fallback used");
    parsed = {
      overview: response.choices[0].message.content,
      bullets: []
    };
  }

  return parsed;
}

// ======================
// ROUTE
// ======================
app.post('/api/post/email/sendMailToBrandBlitz', async (req, res) => {
  try {
    const { platforms, goal, budget, duration, genre, listeners, email } = req.body;

    // Validation
    if (!platforms || !goal || !budget || !duration || !genre || !listeners || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate AI strategy
    const strategy = await generateStrategy({
      platforms,
      goal,
      budget,
      duration,
      genre,
      listeners,
    });

    // Email content
    const mailOptions = {
      from: process.env.NODE_MAILER_USER,
      to: email,
      subject: `Music Promo Strategy - ${platforms.join(', ')}`,
      html: `
        <div style="font-family:Arial;background:#0f0f23;color:#fff;padding:20px">
          <div style="max-width:600px;margin:auto;background:#1a1a2e;padding:20px;border-radius:10px">

            <h2 style="color:#ff6b35;text-align:center">
              🎵 Music Strategy Report
            </h2>

            <p><b>Platforms:</b> ${platforms.join(', ')}</p>
            <p><b>Goal:</b> ${goal}</p>
            <p><b>Budget:</b> ${budget}</p>
            <p><b>Duration:</b> ${duration}</p>
            <p><b>Genre:</b> ${genre}</p>
            <p><b>Listeners:</b> ${listeners}</p>
            <p><b>Email:</b> ${email}</p>

            <hr style="margin:15px 0;border-color:#333" />

            <h3>Strategy Overview</h3>
            <p>${strategy.overview}</p>

            <ul>
              ${strategy.bullets.map(b => `<li>${b}</li>`).join("")}
            </ul>

          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    // Save to DB
    // const db_res = await Strategy.create({
    //   platforms,
    //   goal,
    //   budget,
    //   duration,
    //   genre,
    //   listeners,
    //   email,
    //   strategy
    // });

    return res.json({
      success: true,
      message: "Email sent successfully",
      id: db_res._id
    });

  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message
    });
  }
});

// ======================
// EXPORT (VERY IMPORTANT FOR VERCEL)
// ======================
module.exports = app;
// ml 
