const path = require("path");
const nodemailer = require("nodemailer");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true") === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM || `The House Hub <${SMTP_USER}>`;
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || "";
const EMAIL_BRAND_NAME = process.env.EMAIL_BRAND_NAME || "The House Hub";

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

async function sendEmail({ to, subject, text, html, cc, bcc, replyTo }) {
  if (!to) {
    throw new Error("Recipient email is required");
  }

  const mailOptions = {
    from: EMAIL_FROM,
    to,
    subject: subject || `${EMAIL_BRAND_NAME} Notification`,
    text: text || "",
    html: html || `<p>${text || ""}</p>`,
    ...(cc ? { cc } : {}),
    ...(bcc ? { bcc } : {}),
    ...(replyTo ? { replyTo } : {}),
  };

  return transporter.sendMail(mailOptions);
}

async function verifyEmailTransport() {
  return transporter.verify();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "Pending";
  const amount = Number(value);
  if (Number.isNaN(amount)) return escapeHtml(value);
  return `$${amount.toFixed(2)}`;
}

function buildInfoTable(rows, headerTint = "#f8fafc") {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;margin-bottom:28px;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
      ${rows
        .map(
          ([label, value], index) => `
            <tr>
              <td style="width:38%;padding:14px 18px;border-bottom:${
                index === rows.length - 1 ? "0" : "1px solid #e2e8f0"
              };border-right:1px solid #e2e8f0;background:${headerTint};font-size:14px;font-weight:700;color:#0f172a;vertical-align:top;">${escapeHtml(label)}</td>
              <td style="padding:14px 18px;border-bottom:${
                index === rows.length - 1 ? "0" : "1px solid #e2e8f0"
              };font-size:14px;line-height:1.7;color:#0f172a;vertical-align:top;">${
                value === null || value === undefined || value === ""
                  ? "N/A"
                  : escapeHtml(value)
              }</td>
            </tr>`
        )
        .join("")}
    </table>
  `;
}

function buildSection(title, rows, headerTint) {
  return `
    <h3 style="margin:0 0 8px 0;font-size:16px;line-height:1.4;color:#0f172a;font-weight:800;">${escapeHtml(
      title
    )}</h3>
    ${buildInfoTable(rows, headerTint)}
  `;
}

function renderEmailShell({
  preheader,
  accent = "#1d4ed8",
  badgeText = "NOTICE",
  title,
  intro,
  sections = "",
  footerNote,
  toneLabel = EMAIL_BRAND_NAME,
}) {
  const safeLogoUrl = EMAIL_LOGO_URL ? escapeHtml(EMAIL_LOGO_URL) : "";

  const logoMarkup = safeLogoUrl
    ? `
      <img
        src="${safeLogoUrl}"
        alt="${escapeHtml(EMAIL_BRAND_NAME)}"
        width="54"
        height="54"
        style="display:block;width:54px;height:54px;border-radius:14px;object-fit:cover;border:1px solid #dbe4ff;background:#ffffff;"
      />`
    : `
      <div style="width:54px;height:54px;border-radius:14px;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);color:#ffffff;font-weight:800;font-size:18px;line-height:54px;text-align:center;letter-spacing:0.08em;">
        TH
      </div>`;

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader || title || EMAIL_BRAND_NAME)}
    </div>

    <div style="margin:0;padding:32px 16px;background:linear-gradient(180deg,#eef2ff 0%,#f8fafc 100%);font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #dbe4ff;border-radius:28px;overflow:hidden;box-shadow:0 20px 45px rgba(15,23,42,0.08);">
        <div style="padding:26px 34px;background:linear-gradient(180deg,#f8fbff 0%,#eef4ff 100%);border-bottom:1px solid #dbe4ff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:middle;">
                <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:middle;padding-right:14px;">
                      ${logoMarkup}
                    </td>
                    <td style="vertical-align:middle;">
                      <div style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.2;">${escapeHtml(
                        EMAIL_BRAND_NAME
                      )}</div>
                      <div style="margin-top:4px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;font-weight:700;">Smart Property Management</div>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right" style="vertical-align:middle;white-space:nowrap;">
                <span style="display:inline-block;padding:10px 18px;border-radius:999px;background:#e0e7ff;color:#1d4ed8;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
                  ${escapeHtml(toneLabel)}
                </span>
                <span style="display:inline-block;margin-left:10px;padding:10px 18px;border-radius:999px;background:${accent};color:#ffffff;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
                  ${escapeHtml(badgeText)}
                </span>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:38px 34px 18px 34px;">
          <h1 style="margin:0 0 14px 0;font-size:30px;line-height:1.2;color:#0f172a;font-weight:800;">${escapeHtml(
            title
          )}</h1>
          <p style="margin:0 0 30px 0;font-size:16px;line-height:1.8;color:#64748b;">${escapeHtml(
            intro
          )}</p>
          ${sections}
        </div>

        <div style="padding:24px 34px 30px 34px;border-top:1px solid #e2e8f0;background:#f8fafc;">
          <p style="margin:0 0 8px 0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;font-weight:800;">${escapeHtml(
            EMAIL_BRAND_NAME
          )}</p>
          <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">${escapeHtml(
            footerNote || `This message was sent automatically by ${EMAIL_BRAND_NAME}.`
          )}</p>
        </div>
      </div>
    </div>
  `;
}

function buildMaintenanceCreatedEmail({
  requestNumber,
  title,
  description,
  category,
  priority,
  propertyName,
  propertyAddress,
  unitCode,
  tenantName,
  tenantEmail,
  tenantPhone,
}) {
  const subject = `New Maintenance Request - ${requestNumber}`;

  const text = `
A new maintenance request has been created.

Request Number: ${requestNumber}
Title: ${title || "N/A"}
Description: ${description || "N/A"}
Category: ${category || "N/A"}
Priority: ${priority || "N/A"}

Property: ${propertyName || "N/A"}
Address: ${propertyAddress || "N/A"}
Unit: ${unitCode || "N/A"}

Tenant: ${tenantName || "N/A"}
Tenant Email: ${tenantEmail || "N/A"}
Tenant Phone: ${tenantPhone || "N/A"}

Please review and take the necessary action.
  `.trim();

  const sections = `
    ${buildSection(
      "Request Details",
      [
        ["Request Number", requestNumber],
        ["Title", title],
        ["Description", description],
        ["Category", category],
        ["Priority", priority],
      ],
      "#f8fafc"
    )}

    ${buildSection(
      "Property / Tenant",
      [
        ["Property", propertyName],
        ["Address", propertyAddress],
        ["Unit", unitCode],
        ["Tenant", tenantName],
        ["Tenant Email", tenantEmail],
        ["Tenant Phone", tenantPhone],
      ],
      "#f8fafc"
    )}
  `;

  const html = renderEmailShell({
    preheader: `New maintenance request ${requestNumber}`,
    accent: "#0f172a",
    badgeText: "New Request",
    title: "New Maintenance Request",
    intro:
      "A tenant has submitted a new maintenance request in The House Hub. Please review the request and decide the next action.",
    sections,
    footerNote:
      "This alert was generated automatically by The House Hub maintenance workflow.",
    toneLabel: "Admin Alert",
  });

  return { subject, text, html };
}

function buildMaintenanceApprovalEmail({
  requestNumber,
  title,
  contractorName,
  estimatedLaborCost,
  estimatedMaterialsCost,
  estimatedTotalCost,
}) {
  const subject = `Maintenance Request Approved - ${requestNumber}`;

  const text = `
Your maintenance request has been approved.

Request Number: ${requestNumber}
Title: ${title || "N/A"}
Contractor: ${contractorName || "N/A"}
Estimated Labor Cost: ${formatCurrency(estimatedLaborCost)}
Estimated Materials Cost: ${formatCurrency(estimatedMaterialsCost)}
Estimated Total Cost: ${formatCurrency(estimatedTotalCost)}
  `.trim();

  const sections = `
    <div style="margin-bottom:28px;padding:24px;border-radius:22px;background:linear-gradient(180deg,#f0fdf4 0%,#ffffff 100%);border:1px solid #bbf7d0;">
      <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#15803d;font-weight:800;">Approval Summary</div>
      <div style="margin-top:12px;font-size:26px;line-height:1.25;font-weight:800;color:#0f172a;">Request Approved</div>
      <div style="margin-top:8px;font-size:15px;line-height:1.8;color:#64748b;">
        The maintenance request has been reviewed and approved for execution.
      </div>
    </div>

    ${buildSection(
      "Approval Details",
      [
        ["Request Number", requestNumber],
        ["Title", title],
        ["Contractor", contractorName],
        ["Labor", formatCurrency(estimatedLaborCost)],
        ["Materials", formatCurrency(estimatedMaterialsCost)],
        ["Total", formatCurrency(estimatedTotalCost)],
      ],
      "#f0fdf4"
    )}
  `;

  const html = renderEmailShell({
    preheader: `Maintenance request approved ${requestNumber}`,
    accent: "#16a34a",
    badgeText: "Approved",
    title: "Maintenance Request Approved",
    intro:
      "The maintenance request has been approved and is ready for execution.",
    sections,
    footerNote:
      "Thank you for using The House Hub. This approval message was sent automatically.",
    toneLabel: "Approval Notice",
  });

  return { subject, text, html };
}

function buildMaintenanceAssignmentEmail({
  requestNumber,
  title,
  description,
  category,
  priority,
  preferredDate,
  propertyName,
  propertyAddress,
  unitCode,
  tenantName,
  tenantEmail,
  tenantPhone,
  estimatedLaborCost,
  estimatedMaterialsCost,
  estimatedTotalCost,
  materialsNotes,
}) {
  const subject = `Maintenance Assignment - ${requestNumber}`;

  const text = `
A maintenance request has been assigned to you.

Request Number: ${requestNumber}
Title: ${title || "N/A"}
Description: ${description || "N/A"}
Category: ${category || "N/A"}
Priority: ${priority || "N/A"}
Preferred Date: ${preferredDate || "N/A"}

Property: ${propertyName || "N/A"}
Address: ${propertyAddress || "N/A"}
Unit: ${unitCode || "N/A"}
Tenant: ${tenantName || "N/A"}
Tenant Email: ${tenantEmail || "N/A"}
Tenant Phone: ${tenantPhone || "N/A"}

Estimated Labor Cost: ${formatCurrency(estimatedLaborCost)}
Estimated Materials Cost: ${formatCurrency(estimatedMaterialsCost)}
Estimated Total Cost: ${formatCurrency(estimatedTotalCost)}
Materials Notes: ${materialsNotes || "N/A"}
  `.trim();

  const safePriority = String(priority || "MEDIUM").toUpperCase();
  const priorityColor =
    safePriority === "URGENT"
      ? "#dc2626"
      : safePriority === "HIGH"
      ? "#d97706"
      : safePriority === "MEDIUM"
      ? "#2563eb"
      : "#475569";

  const sections = `
    <div style="margin-bottom:28px;padding:22px 24px;border:1px solid #dbeafe;border-radius:22px;background:linear-gradient(180deg,#eff6ff 0%,#f8fbff 100%);">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#64748b;font-weight:800;">Assigned Request</div>
            <div style="margin-top:10px;font-size:26px;line-height:1.25;font-weight:800;color:#0f172a;">${escapeHtml(
              title || "Maintenance Request"
            )}</div>
            <div style="margin-top:8px;font-size:14px;line-height:1.7;color:#64748b;">
              Request <strong style="color:#0f172a;">${escapeHtml(
                requestNumber || "N/A"
              )}</strong>
            </div>
          </td>
          <td align="right" style="vertical-align:top;white-space:nowrap;">
            <span style="display:inline-block;padding:10px 16px;border-radius:999px;background:${priorityColor};color:#ffffff;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
              ${escapeHtml(safePriority)} Priority
            </span>
          </td>
        </tr>
      </table>
    </div>

    ${buildSection(
      "Request Details",
      [
        ["Request Number", requestNumber],
        ["Title", title],
        ["Description", description],
        ["Category", category],
        ["Priority", safePriority],
        ["Preferred Date", preferredDate],
      ],
      "#f8fafc"
    )}

    ${buildSection(
      "Property / Tenant",
      [
        ["Property", propertyName],
        ["Address", propertyAddress],
        ["Unit", unitCode],
        ["Tenant", tenantName],
        ["Tenant Email", tenantEmail],
        ["Tenant Phone", tenantPhone],
      ],
      "#f8fafc"
    )}

    <div style="margin:4px 0 28px 0;padding:24px;border-radius:22px;background:linear-gradient(180deg,#0f172a 0%,#1e293b 100%);color:#ffffff;">
      <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#93c5fd;font-weight:800;">Estimated Budget</div>
      <div style="margin-top:18px;display:block;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:0 0 14px 0;font-size:14px;color:#cbd5e1;">Labor</td>
            <td align="right" style="padding:0 0 14px 0;font-size:20px;font-weight:800;color:#ffffff;">${formatCurrency(
              estimatedLaborCost
            )}</td>
          </tr>
          <tr>
            <td style="padding:14px 0;font-size:14px;color:#cbd5e1;border-top:1px solid rgba(255,255,255,0.12);">Materials</td>
            <td align="right" style="padding:14px 0;font-size:20px;font-weight:800;color:#ffffff;border-top:1px solid rgba(255,255,255,0.12);">${formatCurrency(
              estimatedMaterialsCost
            )}</td>
          </tr>
          <tr>
            <td style="padding:14px 0 0 0;font-size:15px;color:#ffffff;font-weight:700;border-top:1px solid rgba(255,255,255,0.12);">Total</td>
            <td align="right" style="padding:14px 0 0 0;font-size:26px;font-weight:900;color:#93c5fd;border-top:1px solid rgba(255,255,255,0.12);">${formatCurrency(
              estimatedTotalCost
            )}</td>
          </tr>
        </table>
      </div>
      <div style="margin-top:18px;padding:14px 16px;border-radius:16px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#93c5fd;font-weight:800;">Materials Notes</div>
        <div style="margin-top:8px;font-size:14px;line-height:1.7;color:#e2e8f0;">${escapeHtml(
          materialsNotes || "No materials notes provided."
        )}</div>
      </div>
    </div>

    <div style="padding:20px 22px;border:1px dashed #cbd5e1;border-radius:18px;background:#f8fafc;">
      <div style="font-size:13px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.1em;">Action Required</div>
      <div style="margin-top:10px;font-size:14px;line-height:1.8;color:#475569;">
        Please review the issue, contact the tenant if needed, and proceed with the intervention based on the assignment details above.
      </div>
    </div>
  `;

  const html = renderEmailShell({
    preheader: `Maintenance assignment ${requestNumber}`,
    accent: "#2563eb",
    badgeText: "Assigned",
    title: "Maintenance Assignment",
    intro:
      "A maintenance request has been assigned to you. Please review the issue details below and proceed with the intervention.",
    sections,
    footerNote:
      "This assignment email was generated automatically by The House Hub.",
    toneLabel: "Contractor Alert",
  });

  return { subject, text, html };
}

async function sendMaintenanceCreatedToAdmin(request) {
  const to = process.env.ADMIN_EMAIL || SMTP_USER;
  if (!to) return;

  const tenantName = `${request?.tenant?.firstName || ""} ${
    request?.tenant?.lastName || ""
  }`.trim();

  const propertyAddress = [
    request?.property?.addressLine1,
    request?.property?.city,
  ]
    .filter(Boolean)
    .join(", ");

  const email = buildMaintenanceCreatedEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    description: request?.description,
    category: request?.category,
    priority: request?.priority,
    propertyName: request?.property?.name || request?.property?.code,
    propertyAddress,
    unitCode: request?.unit?.unitCode || request?.unit?.unitName,
    tenantName,
    tenantEmail: request?.tenant?.email,
    tenantPhone: request?.tenant?.phone,
  });

  return sendEmail({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

async function sendMaintenanceAssignedToContractor(request, contractor) {
    const to = contractor?.email || request?.contractor?.email || process.env.CONTRACTOR_TEST_EMAIL;
  if (!to) {
    console.log("⚠️ No contractor email found");
    return;
  }
  
  const tenantName = `${request?.tenant?.firstName || ""} ${
    request?.tenant?.lastName || ""
  }`.trim();

  const propertyAddress = [
    request?.property?.addressLine1,
    request?.property?.city,
  ]
    .filter(Boolean)
    .join(", ");

  const email = buildMaintenanceAssignmentEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    description: request?.description,
    category: request?.category,
    priority: request?.priority,
    preferredDate: request?.preferredDate
    ? new Date(request.preferredDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : null,
    propertyName: request?.property?.name || request?.property?.code,
    propertyAddress,
    unitCode: request?.unit?.unitCode || request?.unit?.unitName,
    tenantName,
    tenantEmail: request?.tenant?.email,
    tenantPhone: request?.tenant?.phone,
    estimatedLaborCost: request?.estimatedLaborCost,
    estimatedMaterialsCost: request?.estimatedMaterialsCost,
    estimatedTotalCost: request?.estimatedTotalCost || request?.estimatedCost,
    materialsNotes: request?.materialsNotes,
  });

  return sendEmail({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

async function sendMaintenanceApprovalToTenant(request, contractor) {
  const to = request?.tenant?.email;
  if (!to) return;

  const email = buildMaintenanceApprovalEmail({
    requestNumber: request?.requestNumber,
    title: request?.title,
    contractorName: contractor?.companyName,
    estimatedLaborCost: request?.estimatedLaborCost,
    estimatedMaterialsCost: request?.estimatedMaterialsCost,
    estimatedTotalCost: request?.estimatedTotalCost || request?.estimatedCost,
  });

  return sendEmail({
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
}

module.exports = {
  sendEmail,
  verifyEmailTransport,
  buildMaintenanceCreatedEmail,
  buildMaintenanceApprovalEmail,
  buildMaintenanceAssignmentEmail,
  sendMaintenanceCreatedToAdmin,
  sendMaintenanceAssignedToContractor,
  sendMaintenanceApprovalToTenant,
};