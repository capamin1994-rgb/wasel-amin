import requests
import uuid

BASE_URL = "http://localhost:3001/"
TIMEOUT = 30

def test_user_authentication_login_and_registration():
    # Unique user info to avoid conflicts
    unique_suffix = uuid.uuid4().hex[:8]
    register_url = BASE_URL + "register"
    login_url = BASE_URL + "login"

    user_data = {
        "username": f"testuser_{unique_suffix}",
        "email": f"test_{unique_suffix}@example.com",
        "password": "TestPassword123!"
    }
    
    session = requests.Session()
    try:
        # Register new user
        register_resp = session.post(register_url, json=user_data, timeout=TIMEOUT)
        assert register_resp.status_code in (200, 201), f"Registration failed with status: {register_resp.status_code}"
        # Ensure response is JSON before parsing
        assert "application/json" in register_resp.headers.get("Content-Type", ""), "Registration response is not JSON"
        register_json = register_resp.json()
        assert "user" in register_json and "id" in register_json["user"], "Registration response missing user id"
        
        # Login with registered user
        login_payload = {
            "email": user_data["email"],
            "password": user_data["password"]
        }
        login_resp = session.post(login_url, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status: {login_resp.status_code}"
        assert "application/json" in login_resp.headers.get("Content-Type", ""), "Login response is not JSON"
        login_json = login_resp.json()
        
        # Validate JWT token issuance
        assert "token" in login_json, "Login response missing JWT token"
        token = login_json["token"]
        assert isinstance(token, str) and token, "Invalid JWT token"
        
        # Validate cookie management - session cookie should be set (if applicable)
        cookie_jar = login_resp.cookies
        assert len(cookie_jar) > 0, "No cookies set on login response"
        
    finally:
        # Cleanup: no deletion endpoint specified
        pass

test_user_authentication_login_and_registration()
