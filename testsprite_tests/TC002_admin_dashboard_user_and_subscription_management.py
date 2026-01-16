import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_admin_dashboard_user_and_subscription_management():
    session = requests.Session()
    admin_credentials = {
        "username": "admin",
        "password": "adminpassword"
    }

    # 1. Login as admin - POST /login (no /auth prefix)
    try:
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        login_resp = session.post(f"{BASE_URL}/login", data=admin_credentials, headers=headers, timeout=TIMEOUT)
        assert login_resp.status_code == 200, f"Login failed with status {login_resp.status_code}"
        content_type = login_resp.headers.get('Content-Type', '')
        assert 'application/json' in content_type, "Login response is not JSON"
        login_data = login_resp.json()
        assert 'token' in login_data, "JWT token missing in login response"
        token = login_data['token']
        auth_headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        # 2. Get list of users - GET /admin/users
        users_resp = session.get(f"{BASE_URL}/admin/users", headers=auth_headers, timeout=TIMEOUT)
        assert users_resp.status_code == 200, f"Get users failed with status {users_resp.status_code}"
        users = users_resp.json()
        assert isinstance(users, list), "Users response should be a list"

        # Prepare user data for creation
        new_user_payload = {
            "username": "testuser_tc002",
            "email": "testuser_tc002@example.com",
            "password": "TestPass123!",
            "role": "user"
        }

        # 3. Create a new user - POST /admin/users
        create_user_resp = session.post(f"{BASE_URL}/admin/users", json=new_user_payload, headers=auth_headers, timeout=TIMEOUT)
        assert create_user_resp.status_code == 201, f"User creation failed with status {create_user_resp.status_code}"
        created_user = create_user_resp.json()
        assert 'id' in created_user, "Created user ID missing"
        created_user_id = created_user['id']

        try:
            # 4. Update the created user - PUT /admin/users/{id}
            update_payload = {
                "email": "updated_tc002@example.com",
                "role": "subscriber"
            }
            update_resp = session.put(f"{BASE_URL}/admin/users/{created_user_id}", json=update_payload, headers=auth_headers, timeout=TIMEOUT)
            assert update_resp.status_code == 200, f"User update failed with status {update_resp.status_code}"
            updated_user = update_resp.json()
            assert updated_user.get("email") == update_payload["email"], "User email not updated correctly"
            assert updated_user.get("role") == update_payload["role"], "User role not updated correctly"

            # 5. Get list of subscription plans - GET /admin/subscriptions
            subs_resp = session.get(f"{BASE_URL}/admin/subscriptions", headers=auth_headers, timeout=TIMEOUT)
            assert subs_resp.status_code == 200, f"Get subscriptions failed with status {subs_resp.status_code}"
            subscriptions = subs_resp.json()
            assert isinstance(subscriptions, list), "Subscriptions response should be a list"

            # 6. Create a subscription plan for the user - POST /admin/subscriptions
            new_sub_payload = {
                "userId": created_user_id,
                "plan": "basic",
                "startDate": "2026-01-01",
                "endDate": "2026-12-31",
                "status": "active"
            }
            create_sub_resp = session.post(f"{BASE_URL}/admin/subscriptions", json=new_sub_payload, headers=auth_headers, timeout=TIMEOUT)
            assert create_sub_resp.status_code == 201, f"Subscription creation failed with status {create_sub_resp.status_code}"
            created_sub = create_sub_resp.json()
            assert "id" in created_sub, "Created subscription ID missing"
            created_sub_id = created_sub["id"]

            try:
                # 7. Update the subscription plan - PUT /admin/subscriptions/{id}
                update_sub_payload = {
                    "status": "paused"
                }
                update_sub_resp = session.put(f"{BASE_URL}/admin/subscriptions/{created_sub_id}", json=update_sub_payload, headers=auth_headers, timeout=TIMEOUT)
                assert update_sub_resp.status_code == 200, f"Subscription update failed with status {update_sub_resp.status_code}"
                updated_sub = update_sub_resp.json()
                assert updated_sub.get("status") == update_sub_payload["status"], "Subscription status not updated correctly"

                # 8. Get system settings - GET /admin/settings
                settings_resp = session.get(f"{BASE_URL}/admin/settings", headers=auth_headers, timeout=TIMEOUT)
                assert settings_resp.status_code == 200, f"Get settings failed with status {settings_resp.status_code}"
                settings = settings_resp.json()
                assert isinstance(settings, dict), "Settings response should be a dict"

                # 9. Update system settings - PUT /admin/settings
                update_settings_payload = {
                    "reminderInterval": 60,
                    "maxSessions": 5
                }
                update_settings_resp = session.put(f"{BASE_URL}/admin/settings", json=update_settings_payload, headers=auth_headers, timeout=TIMEOUT)
                assert update_settings_resp.status_code == 200, f"Update settings failed with status {update_settings_resp.status_code}"
                updated_settings = update_settings_resp.json()
                for key, val in update_settings_payload.items():
                    assert updated_settings.get(key) == val, f"Setting {key} was not updated correctly"

            finally:
                # Cleanup subscription
                del_sub_resp = session.delete(f"{BASE_URL}/admin/subscriptions/{created_sub_id}", headers=auth_headers, timeout=TIMEOUT)
                assert del_sub_resp.status_code == 204, f"Subscription delete failed with status {del_sub_resp.status_code}"

        finally:
            # Cleanup user
            del_user_resp = session.delete(f"{BASE_URL}/admin/users/{created_user_id}", headers=auth_headers, timeout=TIMEOUT)
            assert del_user_resp.status_code == 204, f"User delete failed with status {del_user_resp.status_code}"

    finally:
        # Logout or session cleanup if applicable - not defined explicitly, so just close session
        session.close()


test_admin_dashboard_user_and_subscription_management()
