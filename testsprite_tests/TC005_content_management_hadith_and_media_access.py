import requests

BASE_URL = "http://localhost:3001"
TIMEOUT = 30

def test_content_management_hadith_and_media_access():
    session = requests.Session()

    # Authenticate first (register and login) to get JWT token cookie or header
    user_data = {
        "username": "testuser_tc005",
        "email": "testuser_tc005@example.com",
        "password": "SecurePass123!"
    }
    try:
        # Register user
        r = session.post(f"{BASE_URL}/register", json=user_data, timeout=TIMEOUT)
        assert r.status_code in (200, 201, 409)  # 409 if user exists, that's fine for reruns

        # Login user
        login_data = {
            "email": user_data["email"],
            "password": user_data["password"]
        }
        r = session.post(f"{BASE_URL}/login", json=login_data, timeout=TIMEOUT)
        assert r.status_code == 200
        # Assume JWT token is set in a cookie or authorization header for session usage
        # If JWT is returned in body, extract and set header
        try:
            token = r.json().get("token")
            if token:
                session.headers.update({"Authorization": f"Bearer {token}"})
        except Exception:
            pass

        # --- Hadith content retrieval and update ---
        # Retrieve Hadith list
        r = session.get(f"{BASE_URL}/api/hadith", timeout=TIMEOUT)
        assert r.status_code == 200
        json_resp = r.json()
        hadith_list = json_resp.get('data') if isinstance(json_resp, dict) else json_resp
        assert isinstance(hadith_list, list)

        # If there is at least one hadith, update it, else create one and update
        if hadith_list:
            hadith_id = hadith_list[0].get("id")
        else:
            # Create a Hadith item (assuming POST /api/hadith creates one)
            hadith_create_data = {
                "text": "Sample hadith for testing",
                "reference": "Test Book 1:1"
            }
            r = session.post(f"{BASE_URL}/api/hadith", json=hadith_create_data, timeout=TIMEOUT)
            assert r.status_code in (200,201)
            hadith_id = r.json().get("id")
            assert hadith_id is not None

        hadith_update_data = {
            "text": "Updated Sample Hadith for testing",
            "reference": "Updated Book 1:1"
        }
        r = session.put(f"{BASE_URL}/api/hadith/{hadith_id}", json=hadith_update_data, timeout=TIMEOUT)
        assert r.status_code == 200
        updated_hadith = r.json()
        assert updated_hadith.get("text") == hadith_update_data["text"]
        assert updated_hadith.get("reference") == hadith_update_data["reference"]

        # --- Islamic videos retrieval and update ---
        r = session.get(f"{BASE_URL}/api/islamic-videos", timeout=TIMEOUT)
        assert r.status_code == 200
        json_resp = r.json()
        videos = json_resp.get('data') if isinstance(json_resp, dict) else json_resp
        assert isinstance(videos, list)

        if videos:
            video_id = videos[0].get("id")
        else:
            video_create_data = {
                "title": "Test Video",
                "url": "http://example.com/video",
                "description": "Test Islamic video"
            }
            r = session.post(f"{BASE_URL}/api/islamic-videos", json=video_create_data, timeout=TIMEOUT)
            assert r.status_code in (200,201)
            video_id = r.json().get("id")
            assert video_id is not None

        video_update_data = {
            "title": "Updated Test Video",
            "url": "http://example.com/video-updated",
            "description": "Updated Islamic video"
        }
        r = session.put(f"{BASE_URL}/api/islamic-videos/{video_id}", json=video_update_data, timeout=TIMEOUT)
        assert r.status_code == 200
        updated_video = r.json()
        assert updated_video.get("title") == video_update_data["title"]
        assert updated_video.get("url") == video_update_data["url"]
        assert updated_video.get("description") == video_update_data["description"]

        # --- Background content retrieval and update ---
        r = session.get(f"{BASE_URL}/api/background-content", timeout=TIMEOUT)
        assert r.status_code == 200
        json_resp = r.json()
        background_contents = json_resp.get('data') if isinstance(json_resp, dict) else json_resp
        assert isinstance(background_contents, list)

        if background_contents:
            background_id = background_contents[0].get("id")
        else:
            background_create_data = {
                "name": "Test Background",
                "imageUrl": "http://example.com/background.jpg",
                "description": "Test background content"
            }
            r = session.post(f"{BASE_URL}/api/background-content", json=background_create_data, timeout=TIMEOUT)
            assert r.status_code in (200,201)
            background_id = r.json().get("id")
            assert background_id is not None

        background_update_data = {
            "name": "Updated Test Background",
            "imageUrl": "http://example.com/background-updated.jpg",
            "description": "Updated background content"
        }
        r = session.put(f"{BASE_URL}/api/background-content/{background_id}", json=background_update_data, timeout=TIMEOUT)
        assert r.status_code == 200
        updated_background = r.json()
        assert updated_background.get("name") == background_update_data["name"]
        assert updated_background.get("imageUrl") == background_update_data["imageUrl"]
        assert updated_background.get("description") == background_update_data["description"]

        # --- Other media (assumed route /api/media) retrieval and update ---
        r = session.get(f"{BASE_URL}/api/media", timeout=TIMEOUT)
        assert r.status_code == 200
        json_resp = r.json()
        media_list = json_resp.get('data') if isinstance(json_resp, dict) else json_resp
        assert isinstance(media_list, list)

        if media_list:
            media_id = media_list[0].get("id")
        else:
            media_create_data = {
                "title": "Test Media",
                "url": "http://example.com/media.mp3",
                "type": "audio",
                "description": "Test media content"
            }
            r = session.post(f"{BASE_URL}/api/media", json=media_create_data, timeout=TIMEOUT)
            assert r.status_code in (200,201)
            media_id = r.json().get("id")
            assert media_id is not None

        media_update_data = {
            "title": "Updated Test Media",
            "url": "http://example.com/media-updated.mp3",
            "type": "audio",
            "description": "Updated media content"
        }
        r = session.put(f"{BASE_URL}/api/media/{media_id}", json=media_update_data, timeout=TIMEOUT)
        assert r.status_code == 200
        updated_media = r.json()
        assert updated_media.get("title") == media_update_data["title"]
        assert updated_media.get("url") == media_update_data["url"]
        assert updated_media.get("type") == media_update_data["type"]
        assert updated_media.get("description") == media_update_data["description"]

    finally:
        # Cleanup - delete created resources if the ids exist and user is authenticated
        # Deleting media
        try:
            if 'media_id' in locals():
                session.delete(f"{BASE_URL}/api/media/{media_id}", timeout=TIMEOUT)
        except Exception:
            pass

        # Deleting background content
        try:
            if 'background_id' in locals():
                session.delete(f"{BASE_URL}/api/background-content/{background_id}", timeout=TIMEOUT)
        except Exception:
            pass

        # Deleting Islamic video
        try:
            if 'video_id' in locals():
                session.delete(f"{BASE_URL}/api/islamic-videos/{video_id}", timeout=TIMEOUT)
        except Exception:
            pass

        # Deleting hadith
        try:
            if 'hadith_id' in locals():
                session.delete(f"{BASE_URL}/api/hadith/{hadith_id}", timeout=TIMEOUT)
        except Exception:
            pass

        # Deleting user
        try:
            user_email = user_data["email"]
            # Assuming there's an admin endpoint or authenticated endpoint to delete self user or user by email
            # Since no delete user endpoint info, skip or note requirement
        except Exception:
            pass


test_content_management_hadith_and_media_access()
