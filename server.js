// ─────────────────────────────────────────────────────────
//  Dr. Sharma Homeopathy — Backend API
//  Stack: Node.js + Express + Supabase + CallMeBot (WhatsApp)
//  Deploy: Render.com (free tier)
// ─────────────────────────────────────────────────────────

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios      = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',  // set to your Netlify/GitHub Pages URL
}));
app.use(express.json());

// ── Supabase client ─────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ── WhatsApp via CallMeBot (FREE — no credit card needed) 
//    Setup: https://www.callmebot.com/blog/free-api-whatsapp-messages/
//    Steps:
//      1. Add +34 644 59 85 01 to the doctor's WhatsApp contacts as "CallMeBot"
//      2. Send this message: "I allow callmebot to send me messages"
//      3. You'll receive an apikey — put it in .env as CALLMEBOT_API_KEY
async function sendWhatsApp(doctorPhone, patientData) {
  const { firstName, lastName, mobile, apptDate, address, problem } = patientData;

  const formatted = new Date(apptDate + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const msg =
    `🩺 *New Appointment Request*\n\n` +
    `👤 *Patient:* ${firstName} ${lastName}\n` +
    `📱 *Mobile:* ${mobile}\n` +
    `📅 *Date:* ${formatted}\n` +
    (address ? `🏠 *Address:* ${address}\n` : '') +
    `\n💬 *Concern:*\n${problem}\n\n` +
    `_Sent via Dr. Sharma Homeopathy booking system_`;

  const url = `https://api.callmebot.com/whatsapp.php` +
    `?phone=${encodeURIComponent(doctorPhone)}` +
    `&text=${encodeURIComponent(msg)}` +
    `&apikey=${process.env.CALLMEBOT_API_KEY}`;

  const response = await axios.get(url, { timeout: 10000 });
  return response.data;
}

// ── Health check ────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── POST /api/appointment ────────────────────────────────
app.post('/api/appointment', async (req, res) => {
  const { firstName, lastName, mobile, apptDate, address, problem } = req.body;

  // ── 1. Basic validation ──────────────────────────────
  if (!firstName || !lastName || !mobile || !apptDate || !problem) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^[+\d\s\-]{7,15}$/.test(mobile)) {
    return res.status(400).json({ error: 'Invalid mobile number.' });
  }
  const today = new Date().toISOString().split('T')[0];
  if (apptDate < today) {
    return res.status(400).json({ error: 'Appointment date cannot be in the past.' });
  }

  // ── 2. Save to Supabase ──────────────────────────────
  const { data: record, error: dbError } = await supabase
    .from('appointments')
    .insert([{
      first_name:  firstName,
      last_name:   lastName,
      mobile,
      appt_date:   apptDate,
      address:     address || null,
      problem,
      status:      'pending',         // pending | confirmed | completed | cancelled
      created_at:  new Date().toISOString(),
    }])
    .select()
    .single();

  if (dbError) {
    console.error('Supabase error:', dbError);
    return res.status(500).json({ error: 'Failed to save appointment.' });
  }

  // ── 3. Send WhatsApp to doctor ───────────────────────
  let whatsappStatus = 'sent';
  try {
    await sendWhatsApp(process.env.DOCTOR_PHONE, req.body);
  } catch (waErr) {
    // Don't fail the whole request if WhatsApp fails
    console.error('WhatsApp error:', waErr.message);
    whatsappStatus = 'failed';
  }

  // ── 4. Respond ───────────────────────────────────────
  res.status(201).json({
    success:         true,
    appointmentId:   record.id,
    whatsappStatus,
    message:         'Appointment booked successfully.',
  });
});

// ── GET /api/appointments (simple doctor dashboard read) ─
app.get('/api/appointments', async (req, res) => {
  // Protect with a simple API key header: X-Admin-Key
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .order('appt_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ appointments: data });
});

// ── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  Clinic API running on port ${PORT}`);
});
