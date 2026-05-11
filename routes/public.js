const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const prisma = require("../lib/prisma");

const router = express.Router();

function generatePassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!";
  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars[Math.floor(Math.random() * chars.length)];
  }

  return password;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendLandlordWelcomeEmail({
  to,
  fullName,
  companyName,
  password,
}) {
  const appUrl = process.env.FRONTEND_URL || "https://thehousehub.app/login";
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"The House Hub" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
    to,
    subject: "Your The House Hub admin account is ready",
    html: `
      <div style="font-family:Arial,sans-serif;background:#f4f7fb;padding:24px;">
        <div style="max-width:620px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(90deg,#102a67,#45C9B5);padding:24px;color:#fff;">
            <h2 style="margin:0;">Welcome to The House Hub</h2>
            <p style="margin:6px 0 0;opacity:.85;">Your landlord admin account has been created.</p>
          </div>

          <div style="padding:28px;color:#111827;">
            <p>Hello <strong>${fullName}</strong>,</p>
            <p>Your account for <strong>${companyName}</strong> is ready.</p>

            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin:22px 0;">
              <p><strong>Login URL:</strong> <a href="${appUrl}">${appUrl}</a></p>
              <p><strong>Email:</strong> ${to}</p>
              <p><strong>Temporary Password:</strong> ${password}</p>
              <p><strong>Role:</strong> Admin</p>
            </div>

            <div style="text-align:center;margin-top:26px;">
              <a href="${appUrl}"
                style="display:inline-block;background:#2563eb;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:bold;">
                Login Now
              </a>
            </div>

            <p style="margin-top:22px;color:#6b7280;font-size:13px;">
              For security, please change your password after your first login.
            </p>
          </div>
        </div>
      </div>
    `,
  });
}

router.post("/register-landlord", async (req, res) => {
  try {
    const { name, email, phone, companyName } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({
        error: "Full name and email are required",
      });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).toLowerCase().trim();
    const cleanCompanyName = companyName
    ? String(companyName).trim()
    : `${cleanName}'s Properties`;

    const existingUser = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "An account already exists with this email",
      });
    }

    const temporaryPassword = generatePassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: cleanCompanyName,
          companyName: cleanCompanyName,
          email: cleanEmail,
          phone: phone ? String(phone).trim() : null,
        },
      });

      const user = await tx.user.create({
        data: {
          fullName: cleanName,
          email: cleanEmail,
          passwordHash,
          role: "ADMIN",
          isActive: true,
          mustChangePassword: true,
          organizationId: organization.id,
        },
      });

      return { organization, user };
    });

    sendLandlordWelcomeEmail({
      to: cleanEmail,
      fullName: cleanName,
      companyName: cleanCompanyName,
      password: temporaryPassword,
    }).catch((emailError) => {
      console.error("Welcome email failed:", emailError.message);
    });

    return res.status(201).json({
      success: true,
      message: "Landlord account created successfully",
      organizationId: result.organization.id,
      userId: result.user.id,
    });
  } catch (error) {
    console.error("Register landlord error:", error);
    return res.status(500).json({
      error: error.message || "Failed to create landlord account",
    });
  }
});

module.exports = router;