# Phase 1: Step 2 - Implement Authentication with Supabase

## 1. Google OAuth Setup

### Step 1: Create a Google Cloud Project

#### 1. Go to the Google Cloud Console:
Visit [Google Cloud Console](https://console.cloud.google.com).

#### 2. Create a New Project:
- Click on the project dropdown at the top and select **"New Project."**
- Enter a name for your project and click **"Create."**

### Step 2: Enable the Google Identity API

#### 1. Navigate to APIs & Services:
- In the left sidebar, click on **"APIs & Services" > "Library."**

#### 2. Enable Google Identity API:
- Search for **"Google Identity API"** and click on it.
- Click the **"Enable"** button.

### Step 3: Configure OAuth Consent Screen

#### 1. Go to OAuth Consent Screen:
- In the left sidebar, click on **"APIs & Services" > "OAuth consent screen."**

#### 2. Set Up the Consent Screen:
- Choose **"External"** for user type and click **"Create."**
- Fill in the required fields (App name, User support email, etc.).
- Click **"Save and Continue"** until you reach the end, then click **"Back to Dashboard."**

### Step 4: Create OAuth 2.0 Credentials

#### 1. Go to Credentials:
- In the left sidebar, click on **"APIs & Services" > "Credentials."**

#### 2. Create Credentials:
- Click on **"Create Credentials"** and select **"OAuth client ID."**
- Choose **"Web application"** as the application type.

<!-- I have completed till here. Since this is a chrome extension, do I need to change production URL? Please suggest appropriate action. Where does the Supabase backend figure in all of this? I am confused. Please make me understand. Also, specify where and what I need to specify (In Supabase, In the source code, in the Google Cloud Console, etc.) -->

#### 3. Configure the OAuth Client:
- **Name**: Give your OAuth client a name (e.g., `"Supabase OAuth Client"`).
- **Authorized redirect URIs**: Add the following URIs:
  - For development: `http://localhost:3000` (or your local development URL)
  - For production: Add your production URL (e.g., `https://yourdomain.com`).
- Click **"Create."**

#### 4. Copy Client ID and Client Secret:
- After creating the credentials, you will see your **Client ID** and **Client Secret**.
- Copy these values for later use.

### Step 5: Configure Supabase

#### 1. Go to Supabase Dashboard:
- Navigate to your **Supabase project dashboard**.

#### 2. Authentication Settings:
- Click on the **"Authentication"** section in the left sidebar.
- Under the **"Settings"** tab, find the **"External OAuth Providers"** section.

#### 3. Enable Google:
- Toggle the switch to **enable Google** as an authentication provider.
- Enter the **Client ID** and **Client Secret** you copied from the Google Cloud Console.
- Set the **Redirect URL** to your application’s URL (e.g., `http://localhost:3000`).

#### 4. Save Changes:
- Click the **"Save"** button to apply the changes.

---

## Summary
You have now set up **Google OAuth** in your Supabase project. This will allow users to authenticate using their Google accounts.
