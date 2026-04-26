const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require("openai");
const mongoose = require('mongoose');

dotenv.config();

const app = express();

// ======================
// MongoDB — Vercel-safe cached connection
// ======================
let cached = global.mongoose || (global.mongoose = { conn: null, promise: null });

async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(process.env.MONGO_URI, {
        bufferCommands: false,
      })
      .then((m) => m);
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

// ======================
// Schema & Model
// ======================
const strategySchema = new mongoose.Schema(
  {
    platforms: [String],
    goal:      String,
    budget:    String,
    duration:  String,
    genre:     String,
    listeners: String,
    email:     String,
    strategy: {
      overview: String,
      bullets:  [String],
    },
  },
  { timestamps: true }
);

const Strategy =
  mongoose.models.Strategy || mongoose.model('Strategy', strategySchema);

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
  origin: process.env.ALLOWED_ORIGIN || '*',
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

// Verify transporter on startup (logs a warning instead of crashing mid-request)
transporter.verify((err) => {
  if (err) {
    console.warn("⚠️  Email transporter config error:", err.message);
  } else {
    console.log("✅ Email transporter ready");
  }
});

// ======================
// Helpers
// ======================

// FIX 1: Strip markdown code fences before parsing JSON
function extractJSON(raw) {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

// FIX 4: Escape HTML to prevent XSS in email body
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

Return STRICT JSON (no markdown, no code fences):
{
  "overview": "short paragraph",
  "bullets": ["point 1", "point 2", "point 3"]
}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a music marketing strategist. Respond only with raw JSON — no markdown, no code fences." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
  });

  const raw = response.choices[0].message.content;

  // FIX 1: Strip fences before parsing
  try {
    return JSON.parse(extractJSON(raw));
  } catch (err) {
    console.warn("JSON parse failed, using fallback:", err.message);
    return {
      overview: raw,
      bullets: []
    };
  }
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

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Connect to DB (cached — safe for Vercel serverless)
    await connectDB();

    // Generate AI strategy
    const strategy = await generateStrategy({
      platforms,
      goal,
      budget,
      duration,
      genre,
      listeners,
    });

    // FIX 4: Sanitize all user-supplied values before embedding in HTML
    const safe = {
      platforms: platforms.map(escapeHtml).join(', '),
      goal:      escapeHtml(goal),
      budget:    escapeHtml(budget),
      duration:  escapeHtml(duration),
      genre:     escapeHtml(genre),
      listeners: escapeHtml(listeners),
      email:     escapeHtml(email),
      overview:  escapeHtml(strategy.overview),
      bullets:   (strategy.bullets || []).map(escapeHtml),
    };

    const mailOptions = {
      from: process.env.NODE_MAILER_USER,
      to: email,
      subject: `Music Promo Strategy - ${safe.platforms}`,
      html: `
        <div style="font-family:Arial;background:#0f0f23;color:#fff;padding:20px">
          <div style="max-width:600px;margin:auto;background:#1a1a2e;padding:20px;border-radius:10px">

            <h2 style="color:#ff6b35;text-align:center">
              🎵 Music Strategy Report
            </h2>

            <p><b>Platforms:</b> ${safe.platforms}</p>
            <p><b>Goal:</b> ${safe.goal}</p>
            <p><b>Budget:</b> ${safe.budget}</p>
            <p><b>Duration:</b> ${safe.duration}</p>
            <p><b>Genre:</b> ${safe.genre}</p>
            <p><b>Listeners:</b> ${safe.listeners}</p>
            <p><b>Email:</b> ${safe.email}</p>

            <hr style="margin:15px 0;border-color:#333" />

            <h3>Strategy Overview</h3>
            <p>${safe.overview}</p>

            <ul>
              ${safe.bullets.map(b => `<li>${b}</li>`).join("")}
            </ul>

          </div>
        </div>
      `,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    // Save to MongoDB
    const record = await Strategy.create({
      platforms,
      goal,
      budget,
      duration,
      genre,
      listeners,
      email,
      strategy,
    });

    return res.json({
      success: true,
      message: "Email sent successfully",
      id: record._id,
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
// FIX 2: Local dev server (Vercel uses the export, not listen)
// ======================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

// ======================
// EXPORT FOR VERCEL
// ======================
module.exports = app;
