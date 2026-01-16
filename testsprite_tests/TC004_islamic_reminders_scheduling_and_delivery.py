import requests
import uuid

BASE_URL = "http://localhost:3001/"
TIMEOUT = 30

def test_islamic_reminders_scheduling_and_delivery():
    session = requests.Session()
    headers = {"Content-Type": "application/json"}

    # Step 1: Register a new user
    register_url = BASE_URL + "register"
    random_suffix = str(uuid.uuid4())[:8]
    register_payload = {
        "username": f"testuser_{random_suffix}",
        "email": f"testuser_{random_suffix}@example.com",
        "password": "TestPass123!",
        "planId": "basic-plan"  # Added planId as required by registration API
    }
    resp = session.post(register_url, json=register_payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code == 201, f"User registration failed: {resp.text}"

    # Step 2: Login the user
    login_url = BASE_URL + "login"
    login_payload = {
        "email": register_payload["email"],
        "password": register_payload["password"]
    }
    resp = session.post(login_url, json=login_payload, headers=headers, timeout=TIMEOUT)
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    login_data = resp.json()
    assert "token" in login_data, "JWT token missing in login response"
    token = login_data["token"]

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # Step 3: Create Islamic reminders scheduling preferences for the user
    # Endpoint assumed: POST /islamic-reminders/schedule
    schedule_url = BASE_URL + "islamic-reminders/schedule"
    schedule_payload = {
        "morning_adhkar": True,
        "evening_adhkar": True,
        "fasting_schedule": {
            "enabled": True,
            "method": "standard"  # assuming possible values: standard, custom
        },
        "prayer_times_reminder": {
            "enabled": True,
            "method": "automatic",
            "location": {
                "latitude": 21.3891,
                "longitude": 39.8579,
                "timezone": "Asia/Riyadh"
            }
        },
        "custom_reminders": [
            {
                "name": "Pre-dawn reminder",
                "time": "04:30",
                "enabled": True
            }
        ]
    }
    resp = session.post(schedule_url, json=schedule_payload, headers=auth_headers, timeout=TIMEOUT)
    assert resp.status_code == 201, f"Failed to create Islamic reminders schedule: {resp.text}"
    schedule_data = resp.json()
    assert "id" in schedule_data, "Schedule creation response missing id"
    schedule_id = schedule_data["id"]

    try:
        # Step 4: Retrieve the created schedule and verify details
        get_schedule_url = f"{schedule_url}/{schedule_id}"
        resp = session.get(get_schedule_url, headers=auth_headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Failed to get Islamic reminder schedule: {resp.text}"
        schedule_info = resp.json()
        assert schedule_info["morning_adhkar"] == schedule_payload["morning_adhkar"], "Morning adhkar mismatch"
        assert schedule_info["evening_adhkar"] == schedule_payload["evening_adhkar"], "Evening adhkar mismatch"
        assert schedule_info["fasting_schedule"]["enabled"] == schedule_payload["fasting_schedule"]["enabled"], "Fasting schedule enabled flag mismatch"
        assert schedule_info["fasting_schedule"]["method"] == schedule_payload["fasting_schedule"]["method"], "Fasting schedule method mismatch"
        assert schedule_info["prayer_times_reminder"]["enabled"] == schedule_payload["prayer_times_reminder"]["enabled"], "Prayer times reminder enabled flag mismatch"
        assert schedule_info["prayer_times_reminder"]["method"] == schedule_payload["prayer_times_reminder"]["method"], "Prayer times reminder method mismatch"
        # Location check
        loc = schedule_info["prayer_times_reminder"]["location"]
        assert loc["latitude"] == schedule_payload["prayer_times_reminder"]["location"]["latitude"], "Location latitude mismatch"
        assert loc["longitude"] == schedule_payload["prayer_times_reminder"]["location"]["longitude"], "Location longitude mismatch"
        assert loc["timezone"] == schedule_payload["prayer_times_reminder"]["location"]["timezone"], "Location timezone mismatch"
        # Custom reminders check
        assert "custom_reminders" in schedule_info and len(schedule_info["custom_reminders"]) == 1, "Custom reminders missing or count mismatch"
        cust_rem = schedule_info["custom_reminders"][0]
        assert cust_rem["name"] == schedule_payload["custom_reminders"][0]["name"], "Custom reminder name mismatch"
        assert cust_rem["time"] == schedule_payload["custom_reminders"][0]["time"], "Custom reminder time mismatch"
        assert cust_rem["enabled"] == schedule_payload["custom_reminders"][0]["enabled"], "Custom reminder enabled flag mismatch"

        # Step 5: Update (PUT) the schedule to disable evening adhkar and custom reminders
        update_payload = {
            "morning_adhkar": True,
            "evening_adhkar": False,
            "fasting_schedule": schedule_payload["fasting_schedule"],
            "prayer_times_reminder": schedule_payload["prayer_times_reminder"],
            "custom_reminders": []  # disable all custom reminders
        }
        resp = session.put(get_schedule_url, json=update_payload, headers=auth_headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Failed to update Islamic reminders schedule: {resp.text}"

        # Verify update
        resp = session.get(get_schedule_url, headers=auth_headers, timeout=TIMEOUT)
        assert resp.status_code == 200, "Failed to get updated schedule"
        updated_schedule = resp.json()
        assert updated_schedule["evening_adhkar"] is False, "Evening adhkar update failed"
        assert updated_schedule["custom_reminders"] == [], "Custom reminders update failed"

        # Step 6: (Simulated) Check delivery status endpoint for reminders - assume GET /islamic-reminders/delivery/status
        # The API sends reminders asynchronously; this endpoint provides delivery state per user.
        delivery_status_url = BASE_URL + "islamic-reminders/delivery/status"
        resp = session.get(delivery_status_url, headers=auth_headers, timeout=TIMEOUT)
        assert resp.status_code == 200, f"Failed to get reminders delivery status: {resp.text}"
        delivery_status = resp.json()
        # Validate delivery status structure and expected keys
        assert isinstance(delivery_status, dict), "Delivery status response malformed"
        expected_keys = {"morning_adhkar", "evening_adhkar", "fasting_schedule", "prayer_times_reminder"}
        assert expected_keys.issubset(delivery_status.keys()), "Delivery status missing expected reminders keys"
        # Expected values should be booleans or dicts indicating reminder sent or pending
        # We just check type and presence here
        assert isinstance(delivery_status["morning_adhkar"], dict) or isinstance(delivery_status["morning_adhkar"], bool)
        assert isinstance(delivery_status["evening_adhkar"], dict) or isinstance(delivery_status["evening_adhkar"], bool)
        assert isinstance(delivery_status["fasting_schedule"], dict) or isinstance(delivery_status["fasting_schedule"], bool)
        assert isinstance(delivery_status["prayer_times_reminder"], dict) or isinstance(delivery_status["prayer_times_reminder"], bool)

    finally:
        # Cleanup: delete the created schedule to keep test isolated
        delete_url = f"{schedule_url}/{schedule_id}"
        resp = session.delete(delete_url, headers=auth_headers, timeout=TIMEOUT)
        assert resp.status_code in [200, 204], f"Failed to delete schedule resource: {resp.text}"

        # Cleanup: delete the created user
        # Assuming DELETE /users/me or DELETE /users/{id} is available; else skip
        # First try to get user profile to find user id
        profile_url = BASE_URL + "users/me"
        resp = session.get(profile_url, headers=auth_headers, timeout=TIMEOUT)
        if resp.status_code == 200:
            user_data = resp.json()
            user_id = user_data.get("id")
            if user_id:
                delete_user_url = BASE_URL + f"users/{user_id}"
                resp = session.delete(delete_user_url, headers=auth_headers, timeout=TIMEOUT)
                assert resp.status_code in [200, 204], f"Failed to delete user resource: {resp.text}"

test_islamic_reminders_scheduling_and_delivery()
