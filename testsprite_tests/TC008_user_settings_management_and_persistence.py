import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_user_settings_management_and_persistence():
    # Register a new user
    register_url = f"{BASE_URL}/register"
    register_payload = {
        "username": "testuser_tc008",
        "name": "Test User",
        "phone": "01012345678",
        "isWhatsapp": True,
        "email": "testuser_tc008@example.com",
        "password": "TestPass123!"
    }
    try:
        reg_resp = requests.post(register_url, json=register_payload, timeout=TIMEOUT)
        assert reg_resp.status_code == 201, f"Registration failed: {reg_resp.text}"
        reg_data = reg_resp.json()
        assert "id" in reg_data and reg_data["id"], "User ID missing in registration response"

        # Login the newly registered user
        login_url = f"{BASE_URL}/login"
        login_payload = {
            "email": register_payload["email"],
            "password": register_payload["password"]
        }
        login_resp = requests.post(login_url, json=login_payload, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        assert "token" in login_data and login_data["token"], "JWT token missing in login response"
        token = login_data["token"]

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # Step 1: Set initial user settings - location, reminder preferences, adjustments
        settings_url = f"{BASE_URL}/user/settings"
        initial_settings = {
            "location": {
                "country": "Egypt",
                "city": "Cairo",
                "manual": True
            },
            "reminder_preferences": {
                "morning_adhkar": True,
                "evening_adhkar": True,
                "fasting_schedule": False,
                "custom_reminders": [
                    {"name": "Quran Recitation", "time": "06:00"}
                ]
            },
            "adjustments": {
                "automatic": False,
                "manual_offset_minutes": 5
            }
        }
        upd_resp = requests.put(settings_url, json=initial_settings, headers=headers, timeout=TIMEOUT)
        assert upd_resp.status_code == 200, f"Failed to update user settings: {upd_resp.text}"

        # Step 2: Retrieve the user settings and verify persistence
        get_resp = requests.get(settings_url, headers=headers, timeout=TIMEOUT)
        assert get_resp.status_code == 200, f"Failed to get user settings: {get_resp.text}"
        saved_settings = get_resp.json()
        # Validate saved settings match what we sent
        assert saved_settings.get("location") == initial_settings["location"], "Location mismatch"
        assert saved_settings.get("reminder_preferences") == initial_settings["reminder_preferences"], "Reminder preferences mismatch"
        assert saved_settings.get("adjustments") == initial_settings["adjustments"], "Adjustments mismatch"

        # Step 3: Update settings to automatic adjustments and change location
        updated_settings = {
            "location": {
                "country": "Saudi Arabia",
                "city": "Riyadh",
                "manual": False  # automatic location detection
            },
            "reminder_preferences": {
                "morning_adhkar": False,
                "evening_adhkar": True,
                "fasting_schedule": True,
                "custom_reminders": []
            },
            "adjustments": {
                "automatic": True,
                "manual_offset_minutes": 0
            }
        }
        upd_resp2 = requests.put(settings_url, json=updated_settings, headers=headers, timeout=TIMEOUT)
        assert upd_resp2.status_code == 200, f"Failed to update user settings second time: {upd_resp2.text}"

        # Step 4: Retrieve again and validate updated settings
        get_resp2 = requests.get(settings_url, headers=headers, timeout=TIMEOUT)
        assert get_resp2.status_code == 200, f"Failed to get user settings after update: {get_resp2.text}"
        saved_settings2 = get_resp2.json()
        assert saved_settings2.get("location") == updated_settings["location"], "Updated location mismatch"
        assert saved_settings2.get("reminder_preferences") == updated_settings["reminder_preferences"], "Updated reminder preferences mismatch"
        assert saved_settings2.get("adjustments") == updated_settings["adjustments"], "Updated adjustments mismatch"

        # Step 5: Verify that reminder schedule reflects changed preferences (simulate by fetching reminders)
        reminders_url = f"{BASE_URL}/user/reminders/schedule"
        reminders_resp = requests.get(reminders_url, headers=headers, timeout=TIMEOUT)
        assert reminders_resp.status_code == 200, f"Failed to get reminder schedule: {reminders_resp.text}"
        reminders = reminders_resp.json()
        # Check that reminders match the updated preferences
        # Morning adhkar should not be in schedule, fasting schedule should be present
        morning_adhkar_present = any(r.get("type") == "morning_adhkar" for r in reminders)
        fasting_schedule_present = any(r.get("type") == "fasting_schedule" for r in reminders)
        assert not morning_adhkar_present, "Morning adhkar reminder should NOT be present"
        assert fasting_schedule_present, "Fasting schedule reminder should be present"

    finally:
        # Cleanup - delete user
        if 'token' in locals():
            # Attempt to delete user
            user_del_url = f"{BASE_URL}/user"
            try:
                del_resp = requests.delete(user_del_url, headers=headers, timeout=TIMEOUT)
                # Accept 200 or 204 as success for deletion
                assert del_resp.status_code in (200, 204), f"Failed to delete user after test: {del_resp.text}"
            except Exception:
                pass

test_user_settings_management_and_persistence()
