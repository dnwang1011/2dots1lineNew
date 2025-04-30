// DOM Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const loginFormElement = document.getElementById('login-form');
const signupFormElement = document.getElementById('signup-form');
const loginResponseMessage = document.getElementById('login-response');
const signupResponseMessage = document.getElementById('signup-response');

// API URLs
const API_URL = 'http://localhost:3002/api';

// Switch tabs
loginTab.addEventListener('click', () => {
  loginTab.classList.add('active');
  signupTab.classList.remove('active');
  loginFormElement.classList.add('active');
  signupFormElement.classList.remove('active');
});

signupTab.addEventListener('click', () => {
  signupTab.classList.add('active');
  loginTab.classList.remove('active');
  signupFormElement.classList.add('active');
  loginFormElement.classList.remove('active');
});

// Helper to display response messages
function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.remove('response-success', 'response-error');
  element.classList.add(isError ? 'response-error' : 'response-success');
  element.style.display = 'block';
  
  setTimeout(() => {
    element.style.display = 'none';
  }, 5000);
}

// Store user data in session storage
function storeUserData(userData, token) {
  // Store in both session and local storage for persistence
  sessionStorage.setItem('user', JSON.stringify(userData));
  sessionStorage.setItem('token', token);
  
  // Also store in localStorage for persistence across tabs/sessions
  localStorage.setItem('user', JSON.stringify(userData));
  localStorage.setItem('token', token);
  
  // Set cookie as a fallback
  document.cookie = `token=${token}; path=/; max-age=86400`; // 1 day
}

// Check if user is logged in
function checkAuth() {
  // Try multiple storage locations
  const sessionToken = sessionStorage.getItem('token');
  const localToken = localStorage.getItem('token');
  const cookieToken = getCookie('token');
  
  // Use the first available token
  const token = sessionToken || localToken || cookieToken;
  
  // If token exists but not in sessionStorage, synchronize storage
  if (!sessionToken && token) {
    sessionStorage.setItem('token', token);
    console.log('Found token in alternate storage, synchronized to sessionStorage');
  }
  
  // Get user data from available sources
  const sessionUser = sessionStorage.getItem('user');
  const localUser = localStorage.getItem('user');
  
  // Use the first available user data
  const userData = sessionUser || localUser;
  
  // If user data exists but not in sessionStorage, synchronize storage
  if (!sessionUser && userData) {
    sessionStorage.setItem('user', userData);
    console.log('Found user data in localStorage, synchronized to sessionStorage');
  }
  
  if (token && userData) {
    return true;
  }
  
  // Clear invalid storage if token exists but user data doesn't
  if (token && !userData) {
    console.log('Token exists but no user data, clearing invalid state');
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    document.cookie = 'token=; path=/; max-age=0';
  }
  
  return false;
}

// Helper to get cookie value
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

// Update UI based on auth state
function updateAuthUI() {
    const token = sessionStorage.getItem('token');
    const user = sessionStorage.getItem('user');
    const authButtons = document.getElementById('auth-buttons');
    const welcomeMessage = document.getElementById('welcome-message');
    const loginBtn = authButtons.querySelector('.login-btn');
    const signupBtn = authButtons.querySelector('.signup-btn');
    const logoutBtn = document.getElementById('logout-btn');

    if (token && user) {
        // User is logged in
        if (loginBtn) loginBtn.style.display = 'none';
        if (signupBtn) signupBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-flex';
        
        // Show welcome message
        if (welcomeMessage) {
            const userData = JSON.parse(user);
            welcomeMessage.textContent = `Welcome, ${userData.firstName || 'User'}!`;
            welcomeMessage.style.display = 'block';
        }

        // Ensure logout event listener is attached
        if (logoutBtn && !logoutBtn.hasListener) {
            logoutBtn.addEventListener('click', handleLogout);
            logoutBtn.hasListener = true;
        }
    } else {
        // User is logged out
        if (loginBtn) loginBtn.style.display = 'inline-flex';
        if (signupBtn) signupBtn.style.display = 'inline-flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        
        // Hide welcome message
        if (welcomeMessage) {
            welcomeMessage.style.display = 'none';
        }
    }
}

// Handle Login
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  
  if (!email || !password) {
    showMessage(loginResponseMessage, 'Please fill in all fields', true);
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Failed to login');
    }
    
    showMessage(loginResponseMessage, 'Login successful! Redirecting...');
    storeUserData(data.user, data.token);
    
    // Redirect after successful login
    setTimeout(() => {
      window.location.href = '/';
    }, 1500);
    
  } catch (error) {
    showMessage(loginResponseMessage, error.message, true);
  }
}

// Handle Signup
async function handleSignup(e) {
  e.preventDefault();
  const firstName = document.getElementById('signup-firstname').value;
  const lastName = document.getElementById('signup-lastname').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  
  if (!firstName || !lastName || !email || !password) {
    showMessage(signupResponseMessage, 'Please fill in all fields', true);
    return;
  }
  
  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email,
        password
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Failed to sign up');
    }
    
    showMessage(signupResponseMessage, 'Registration successful! Please log in with your new account.');
    
    // Switch to the login tab after successful registration
    setTimeout(() => {
      loginTab.click();
    }, 1500);
    
  } catch (error) {
    showMessage(signupResponseMessage, error.message, true);
  }
}

// Handle Logout
async function handleLogout() {
  try {
    const token = sessionStorage.getItem('token');
    
    if (!token) {
      throw new Error('No authentication token found');
    }
    
    const response = await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || 'Failed to logout');
    }
    
    // Clear session storage
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token');
    
    // Redirect after logout
    window.location.href = '/';
    
  } catch (error) {
    console.error('Logout error:', error);
    // Still clear session storage even if the API call fails
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token');
    window.location.href = '/';
  }
}

// Event Listeners
if (loginForm) {
  loginForm.addEventListener('submit', handleLogin);
}

if (signupForm) {
  signupForm.addEventListener('submit', handleSignup);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
}); 