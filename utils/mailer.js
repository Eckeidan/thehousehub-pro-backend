const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendTenantWelcomeEmail({
  to,
  tenantName,
  propertyName,
  leaseStart,
  leaseEnd,
  monthlyRent,
  loginEmail,
  temporaryPassword,
}) {
  const loginUrl = `${process.env.FRONTEND_URL}/login`;

  await transporter.sendMail({
    from: `"The House Hub" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Tenant Account Has Been Created",
    html: `
      <div style="font-family: Arial, sans-serif; background:#f8fafc; padding:40px;">
        <div style="max-width:650px; margin:auto; background:white; border-radius:20px; padding:40px; border:1px solid #e2e8f0;">
          
          <h1 style="color:#0f172a; margin-bottom:10px;">
            Welcome to The House Hub
          </h1>

          <p style="color:#475569; font-size:15px;">
            Hello <strong>${tenantName}</strong>,
          </p>

          <p style="color:#475569; font-size:15px; line-height:1.8;">
            Your tenant portal account has been successfully created.
          </p>

          <div style="margin-top:30px; background:#f8fafc; border-radius:16px; padding:24px; border:1px solid #e2e8f0;">
            
            <h3 style="margin-top:0; color:#0f172a;">
              Account Information
            </h3>

            <p><strong>Email:</strong> ${loginEmail}</p>
            <p><strong>Temporary Password:</strong> ${temporaryPassword}</p>

            <hr style="margin:20px 0; border:none; border-top:1px solid #e2e8f0;" />

            <h3 style="color:#0f172a;">
              Lease Information
            </h3>

            <p><strong>Property:</strong> ${propertyName || "N/A"}</p>
            <p><strong>Lease Start:</strong> ${leaseStart || "N/A"}</p>
            <p><strong>Lease End:</strong> ${leaseEnd || "N/A"}</p>
            <p><strong>Monthly Payment:</strong> $${monthlyRent || 0}</p>
          </div>

          <div style="margin-top:30px;">
            <a
              href="${loginUrl}"
              style="
                display:inline-block;
                background:#2563eb;
                color:white;
                padding:14px 22px;
                border-radius:12px;
                text-decoration:none;
                font-weight:bold;
              "
            >
              Login To Your Account
            </a>
          </div>

          <p style="margin-top:30px; color:#64748b; font-size:13px; line-height:1.7;">
            For security reasons, you will be asked to change your password after your first login.
          </p>

        </div>
      </div>
    `,
  });
}

module.exports = {
  sendTenantWelcomeEmail,
};