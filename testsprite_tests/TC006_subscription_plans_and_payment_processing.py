import requests

BASE_URL = "http://localhost:3001/"
TIMEOUT = 30

def test_subscription_plans_and_payment_processing():
    session = requests.Session()
    try:
        # 1. Register a new user
        register_payload = {
            "name": "Test User TC006",
            "phone": "01012345678",
            "isWhatsapp": True,
            "email": "testuser_tc006@example.com",
            "password": "SecurePass123!"
        }
        register_resp = session.post(
            f"{BASE_URL}register",
            json=register_payload,
            timeout=TIMEOUT
        )
        assert register_resp.status_code == 201, f"Registration failed: {register_resp.text}"

        # 2. Login with the newly registered user
        login_payload = {
            "email": register_payload["email"],
            "password": register_payload["password"]
        }
        login_resp = session.post(
            f"{BASE_URL}login",
            json=login_payload,
            timeout=TIMEOUT
        )
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        login_data = login_resp.json()
        assert "token" in login_data, "JWT token missing in login response"
        token = login_data["token"]
        session.headers.update({"Authorization": f"Bearer {token}"})

        # 3. Retrieve subscription plans
        plans_resp = session.get(
            f"{BASE_URL}plans",
            timeout=TIMEOUT
        )
        assert plans_resp.status_code == 200, f"Failed to get subscription plans: {plans_resp.text}"
        plans = plans_resp.json()
        assert isinstance(plans, list) and len(plans) > 0, "Plans list is empty or invalid"

        # Choose the first plan for subscription
        selected_plan = plans[0]
        assert "id" in selected_plan, "Selected plan has no id"

        # 4. Create a subscription for the user with the selected plan
        subscription_payload = {
            "planId": selected_plan["id"],
            "paymentMethod": "credit_card",
            # Minimal payment details, adapt if API requires more
            "paymentDetails": {
                "cardNumber": "4111111111111111",
                "expiryMonth": "12",
                "expiryYear": "2030",
                "cvc": "123"
            }
        }
        subscribe_resp = session.post(
            f"{BASE_URL}subscriptions",
            json=subscription_payload,
            timeout=TIMEOUT
        )
        assert subscribe_resp.status_code in (200, 201), f"Subscription creation failed: {subscribe_resp.text}"
        subscription = subscribe_resp.json()
        assert subscription.get("status") == "active" or subscription.get("status") == "pending", "Subscription status unexpected"

        subscription_id = subscription.get("id")
        assert subscription_id is not None, "Subscription ID missing"

        # 5. Test payment processing error - invalid card number
        invalid_payment_payload = {
            "planId": selected_plan["id"],
            "paymentMethod": "credit_card",
            "paymentDetails": {
                "cardNumber": "0000000000000000",
                "expiryMonth": "01",
                "expiryYear": "2025",
                "cvc": "000"
            }
        }
        invalid_payment_resp = session.post(
            f"{BASE_URL}subscriptions",
            json=invalid_payment_payload,
            timeout=TIMEOUT
        )
        assert invalid_payment_resp.status_code >= 400, "Invalid payment accepted unexpectedly"
        err_data = invalid_payment_resp.json()
        assert "error" in err_data or "message" in err_data, "Error message missing in invalid payment response"

    finally:
        # Cleanup: delete subscription if created
        if 'subscription_id' in locals():
            session.delete(
                f"{BASE_URL}subscriptions/{subscription_id}",
                timeout=TIMEOUT
            )
        # Cleanup: delete test user
        # Assume API has endpoint DELETE /users/me
        session.delete(
            f"{BASE_URL}users/me",
            timeout=TIMEOUT
        )

test_subscription_plans_and_payment_processing()
