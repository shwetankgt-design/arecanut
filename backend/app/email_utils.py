import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from .config import get_settings

logger = logging.getLogger("arecanut.email")
settings = get_settings()


def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> None:
    """
    Sends an email via SMTP when credentials are configured. In any environment
    without SMTP configured (local dev by default), the message is logged
    instead of sent — this keeps the reset flow fully testable without a real
    mail account, while never silently failing in a way that hides an error in
    a real deployment.
    """
    if not settings.smtp_configured:
        logger.warning(
            "SMTP not configured — logging email instead of sending.\n"
            "To: %s\nSubject: %s\n%s",
            to_email, subject, text_body,
        )
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        if settings.SMTP_USE_TLS:
            server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())


def send_password_reset_email(to_email: str, full_name: str, reset_link: str, expires_minutes: int) -> None:
    subject = "Reset your Arecanut Farmer Survey password"
    text_body = (
        f"Hi {full_name},\n\n"
        f"We received a request to reset your password. This link is valid for "
        f"{expires_minutes} minutes and can be used once:\n\n{reset_link}\n\n"
        "If you didn't request this, you can safely ignore this email — your "
        "password will not be changed."
    )
    html_body = f"""
    <div style="font-family: Segoe UI, Arial, sans-serif; max-width: 480px; margin: auto;">
      <div style="background: linear-gradient(135deg, #5A2D82, #A6266E); padding: 20px; border-radius: 12px 12px 0 0; color: white;">
        <strong style="font-size: 16px;">Arecanut Farmer Survey</strong>
      </div>
      <div style="border: 1px solid #E4DEEE; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p>Hi {full_name},</p>
        <p>We received a request to reset your password. This link is valid for
        <b>{expires_minutes} minutes</b> and can only be used once.</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="{reset_link}" style="background:#5A2D82;color:white;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">Reset Password</a>
        </p>
        <p style="color:#6B6478;font-size:12px;">If you didn't request this, you can safely ignore this email —
        your password will not be changed.</p>
      </div>
    </div>
    """
    send_email(to_email, subject, html_body, text_body)
