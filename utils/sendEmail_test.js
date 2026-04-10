const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const nodemailer = require("nodemailer");

/**
 * CONFIGURATION SMTP (GMAIL)
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * TEST FUNCTION
 */
async function sendTestEmail() {
  try {
    console.log("🔄 Connecting to SMTP...");
    console.log("SMTP_HOST =", process.env.SMTP_HOST);
    console.log("SMTP_PORT =", process.env.SMTP_PORT);
    console.log("SMTP_SECURE =", process.env.SMTP_SECURE);
    console.log("SMTP_USER =", process.env.SMTP_USER);
    console.log("SMTP_PASS exists =", !!process.env.SMTP_PASS);
    console.log(
      "SMTP_PASS length =",
      process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0
    );

    await transporter.verify();
    console.log("✅ SMTP connection successful");

    console.log("📨 Sending test email...");

    const info = await transporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        `"The House Hub" <${process.env.SMTP_USER}>`,
      to: "chrismonga@gmail.com",
      subject: "🚀 PropertyOS SMTP Test - SUCCESS",
      text: "If you see this, Gmail SMTP is working perfectly.",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #16a34a;">✅ Gmail SMTP Test Successful</h2>
          <p>This email was sent from your PropertyOS backend.</p>
          <hr />
          <p><strong>Sender:</strong> ${process.env.SMTP_USER}</p>
          <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
      `,
    });

    console.log("✅ Email sent successfully!");
    console.log("📩 Message ID:", info.messageId);
  } catch (error) {
    console.error("❌ EMAIL TEST FAILED");
    console.error("Message:", error.message);
    console.error(error);
  }
}

sendTestEmail();