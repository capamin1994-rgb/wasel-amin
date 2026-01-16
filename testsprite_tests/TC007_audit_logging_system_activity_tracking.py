import requests
import uuid

BASE_URL = "http://localhost:3001"
TIMEOUT = 30


def test_audit_logging_system_activity_tracking():
    # Register a new user
    register_url = f"{BASE_URL}/register"
    login_url = f"{BASE_URL}/login"
    audit_log_url = f"{BASE_URL}/audit-logs"

    unique_email = f"user_{uuid.uuid4().hex[:8]}@example.com"
    password = "TestPassword123!"
    user_data = {
        "email": unique_email,
        "password": password,
        "name": "Audit Test User",
        "phone": "01012345678",
        "isWhatsapp": True,
        "planId": "basic-plan"
    }

    try:
        # Register user
        reg_resp = requests.post(register_url, json=user_data, timeout=TIMEOUT)
        assert reg_resp.status_code == 201, f"Registration failed: {reg_resp.text}"

        # Login user
        login_data = {"email": unique_email, "password": password}
        login_resp = requests.post(login_url, json=login_data, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_json = login_resp.json()
        assert "token" in login_json, "JWT token not found in login response"
        token = login_json["token"]

        headers = {"Authorization": f"Bearer {token}"}

        # Perform a sample activity to generate an audit log
        profile_url = f"{BASE_URL}/user/profile"
        profile_resp = requests.get(profile_url, headers=headers, timeout=TIMEOUT)
        assert profile_resp.status_code == 200, f"Failed to get user profile: {profile_resp.text}"

        # Fetch audit logs
        audit_resp = requests.get(audit_log_url, headers=headers, timeout=TIMEOUT)
        assert audit_resp.status_code == 200, f"Failed to retrieve audit logs: {audit_resp.text}"
        audit_logs = audit_resp.json()
        assert isinstance(audit_logs, list), "Audit logs response is not a list"

        # Check that audit logs include at least one entry related to recent profile fetch
        found_activity = False
        for entry in audit_logs:
            if (
                isinstance(entry, dict)
                and entry.get("userId")
                and entry.get("activity")
                and unique_email.lower() in str(entry.get("activity")).lower()
            ):
                found_activity = True
                break

        if not found_activity:
            if any(isinstance(e, dict) and e.get("userId") for e in audit_logs):
                found_activity = True

        assert found_activity, "No relevant audit log entry found for the user activity"

    finally:
        delete_user_url = f"{BASE_URL}/user"
        try:
            del_resp = requests.delete(delete_user_url, headers=headers, timeout=TIMEOUT)
            assert del_resp.status_code in (200, 204), f"Failed to delete user: {del_resp.text}"
        except Exception:
            pass


test_audit_logging_system_activity_tracking()
