import requests
import time

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_whatsapp_session_management_and_message_handling():
    session = requests.Session()
    try:
        # Step 1: Register a test user (required to create WhatsApp session)
        register_payload = {
            "username": "testuser_tc003",
            "email": "testuser_tc003@example.com",
            "password": "TestPass123!"
        }
        register_resp = session.post(f"{BASE_URL}/register", json=register_payload, timeout=TIMEOUT)
        assert register_resp.status_code == 201 or register_resp.status_code == 200, "User registration failed"
        
        # Step 2: Login with the registered user
        login_payload = {
            "email": "testuser_tc003@example.com",
            "password": "TestPass123!"
        }
        login_resp = session.post(f"{BASE_URL}/login", json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, "User login failed"
        json_login = login_resp.json()
        assert "token" in json_login, "JWT token missing in login response"
        token = json_login["token"]
        
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # Step 3: Create WhatsApp session (start QR code generation)
        create_session_resp = session.post(f"{BASE_URL}/whatsapp/session", headers=headers, timeout=TIMEOUT)
        assert create_session_resp.status_code == 201 or create_session_resp.status_code == 200, "Failed to create WhatsApp session"
        # Check if response contains JSON
        try:
            session_data = create_session_resp.json() if create_session_resp.content else {}
        except Exception:
            session_data = {}
        assert "sessionId" in session_data, "sessionId missing in WhatsApp session creation response"
        assert "qrCode" in session_data and isinstance(session_data["qrCode"], str) and len(session_data["qrCode"]) > 0, "QR code missing or invalid in response"
        session_id = session_data["sessionId"]

        # Step 4: Simulate waiting for connection establishment after QR scanning
        connected = False
        for _ in range(15):  # wait max ~30 seconds
            status_resp = session.get(f"{BASE_URL}/whatsapp/session/{session_id}/status", headers=headers, timeout=TIMEOUT)
            assert status_resp.status_code == 200, "Failed to get WhatsApp session status"
            status_json = status_resp.json()
            if status_json.get("connected") is True:
                connected = True
                break
            time.sleep(2)
        assert connected, "WhatsApp session did not connect within timeout period"

        # Step 5: Send a WhatsApp message using the session
        send_message_payload = {
            "sessionId": session_id,
            "to": "1234567890@s.whatsapp.net",
            "message": "Test message from TC003"
        }
        send_resp = session.post(f"{BASE_URL}/whatsapp/message/send", headers=headers, json=send_message_payload, timeout=TIMEOUT)
        assert send_resp.status_code == 200, "Failed to send WhatsApp message"
        send_json = send_resp.json()
        assert send_json.get("success") is True, "Sending WhatsApp message reported failure"

        # Step 6: Retrieve received messages for the session (simulate receiving)
        messages_resp = session.get(f"{BASE_URL}/whatsapp/session/{session_id}/messages", headers=headers, timeout=TIMEOUT)
        assert messages_resp.status_code == 200, "Failed to get messages for WhatsApp session"
        messages_json = messages_resp.json()
        assert isinstance(messages_json, list), "Messages response is not a list"
        assert any("Test message from TC003" in (msg.get("text") or "") for msg in messages_json), "Sent message not found in received messages"

    finally:
        if 'session_id' in locals():
            try:
                del_resp = session.delete(f"{BASE_URL}/whatsapp/session/{session_id}", headers=headers, timeout=TIMEOUT)
                assert del_resp.status_code == 200 or del_resp.status_code == 204, "Failed to delete WhatsApp session"
            except Exception:
                pass
        try:
            del_user_resp = session.delete(f"{BASE_URL}/user/self", headers=headers, timeout=TIMEOUT)
            assert del_user_resp.status_code in [200, 204, 404]
        except Exception:
            pass

test_whatsapp_session_management_and_message_handling()
