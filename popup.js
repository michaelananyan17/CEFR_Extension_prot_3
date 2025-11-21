// CEFR Level definitions
const CEFR_LEVELS = {
    'A1': {
        name: 'Beginner',
        description: 'Can understand and use familiar everyday expressions and very basic phrases.'
    },
    'A2': {
        name: 'Elementary', 
        description: 'Can understand sentences and frequently used expressions related to areas of most immediate relevance.'
    },
    'B1': {
        name: 'Intermediate',
        description: 'Can understand the main points of clear standard input on familiar matters regularly encountered in work, school, leisure, etc.'
    },
    'B2': {
        name: 'Upper Intermediate',
        description: 'Can understand the main ideas of complex text on both concrete and abstract topics, including technical discussions.'
    },
    'C1': {
        name: 'Advanced',
        description: 'Can understand a wide range of demanding, longer texts, and recognize implicit meaning.'
    },
    'C2': {
        name: 'Proficiency',
        description: 'Can understand with ease virtually everything heard or read.'
    }
};

// DOM elements
const cefrSlider = document.getElementById('cefr-slider');
const cefrLevel = document.getElementById('cefr-level');
const levelName = document.getElementById('level-name');
const levelDescription = document.getElementById('level-description');
const levelToggle = document.getElementById('level-toggle');
const toggleIcon = document.getElementById('toggle-icon');
const rewriteBtn = document.getElementById('rewrite-btn');
const summarizeBtn = document.getElementById('summarize-btn');
const resetBtn = document.getElementById('reset-btn');
const apiKeyInput = document.getElementById('api-key');
const saveApiKeyBtn = document.getElementById('save-api-key');
const statusDiv = document.getElementById('status');
const apiStatus = document.getElementById('api-status');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

// Initialize the popup
function initPopup() {
    loadSavedSettings();
    setupEventListeners();
    updateLevelDisplay(cefrSlider.value);
    
    // Listen for progress updates from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'progressUpdate') {
            updateProgress(request.progress);
        }
    });
}

// Load saved settings from chrome.storage
function loadSavedSettings() {
    chrome.storage.sync.get(['apiKey', 'cefrLevel'], (result) => {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
            updateApiKeyStatus(result.apiKey);
            rewriteBtn.disabled = false;
            summarizeBtn.disabled = false;
        }
        if (result.cefrLevel) {
            cefrSlider.value = result.cefrLevel;
            updateLevelDisplay(result.cefrLevel);
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    cefrSlider.addEventListener('input', (e) => {
        updateLevelDisplay(e.target.value);
        saveCefrLevel(e.target.value);
    });
    
    levelToggle.addEventListener('click', toggleLevelDescription);
    
    rewriteBtn.addEventListener('click', rewritePage);
    summarizeBtn.addEventListener('click', summarizePage);
    resetBtn.addEventListener('click', resetPage);
    saveApiKeyBtn.addEventListener('click', saveApiKey);
    apiKeyInput.addEventListener('input', () => {
        updateApiKeyStatus(apiKeyInput.value.trim());
    });
}

// Toggle level description visibility
function toggleLevelDescription() {
    levelDescription.classList.toggle('show');
    toggleIcon.textContent = levelDescription.classList.contains('show') ? '▲' : '▼';
}

// Update level display based on slider value
function updateLevelDisplay(value) {
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const level = levels[value - 1];
    const levelInfo = CEFR_LEVELS[level];
    
    cefrLevel.textContent = level;
    levelName.textContent = levelInfo.name;
    levelDescription.textContent = levelInfo.description;
}

// Save CEFR level to storage
function saveCefrLevel(level) {
    chrome.storage.sync.set({ cefrLevel: level });
}

// Validate API key format
function validateApiKey(apiKey) {
    if (!apiKey) return { valid: false, message: 'Please enter an API key' };
    if (!apiKey.startsWith('sk-')) return { valid: false, message: 'Invalid API key format' };
    if (apiKey.length < 20) return { valid: false, message: 'API key seems too short' };
    return { valid: true, message: 'API key looks valid' };
}

// Update API key status display
function updateApiKeyStatus(apiKey) {
    const validation = validateApiKey(apiKey);
    
    if (apiKey) {
        apiStatus.textContent = validation.valid ? '✅ Configured' : '⚠️ Invalid';
        apiStatus.className = `api-status ${validation.valid ? 'valid' : 'invalid'}`;
    } else {
        apiStatus.textContent = 'Not configured';
        apiStatus.className = 'api-status';
    }
}

// Save API key to storage
function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    const validation = validateApiKey(apiKey);
    
    if (!validation.valid) {
        showStatus(validation.message, 'error');
        return;
    }
    
    showStatus('<span class="spinner"></span>Validating API key...', 'processing');
    
    // Test the API key with a simple request
    testApiKey(apiKey).then(isValid => {
        if (isValid) {
            chrome.storage.sync.set({ apiKey: apiKey }, () => {
                showStatus('API key saved and verified!', 'success');
                updateApiKeyStatus(apiKey);
                rewriteBtn.disabled = false;
                summarizeBtn.disabled = false;
            });
        } else {
            showStatus('API key validation failed. Please check your key.', 'error');
            updateApiKeyStatus('');
        }
    }).catch(error => {
        showStatus(`API key test failed: ${error.message}`, 'error');
        updateApiKeyStatus('');
    });
}

// Test API key with a simple request
async function testApiKey(apiKey) {
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        
        if (response.status === 401) {
            return false; // Unauthorized - invalid key
        }
        return response.ok;
    } catch (error) {
        console.error('API key test error:', error);
        return false;
    }
}

// Show status message
function showStatus(message, type = 'info') {
    statusDiv.innerHTML = message;
    statusDiv.className = `status ${type}`;
    
    if (type !== 'processing') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 4000);
    }
}

// Update progress display
function updateProgress(progress) {
    progressContainer.classList.add('show');
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `Processing: ${progress}%`;
    
    if (progress >= 100) {
        setTimeout(() => {
            progressContainer.classList.remove('show');
        }, 2000);
    }
}

// Rewrite page content
async function rewritePage() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus('Please enter and save your OpenAI API key first', 'error');
        return;
    }
    
    const levelValue = cefrSlider.value;
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const targetLevel = levels[levelValue - 1];
    
    // Show progress container
    progressContainer.classList.add('show');
    updateProgress(0);
    
    showStatus('<span class="spinner"></span>Starting rewrite process...', 'processing');
    
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Send message to content script to rewrite the page
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'rewritePage',
            apiKey: apiKey,
            targetLevel: targetLevel
        });
        
        if (response.success) {
            showStatus(`Page rewritten to ${targetLevel} level!`, 'success');
            // Progress will be updated to 100% via the message listener
        } else {
            showStatus(`Error: ${response.error}`, 'error');
            progressContainer.classList.remove('show');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
        progressContainer.classList.remove('show');
        console.error('Rewrite error:', error);
    }
}

// Summarize page content and download as text file
async function summarizePage() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showStatus('Please enter and save your OpenAI API key first', 'error');
        return;
    }
    
    const levelValue = cefrSlider.value;
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const targetLevel = levels[levelValue - 1];
    
    showStatus('<span class="spinner"></span>Creating summary...', 'processing');
    
    try {
        // Get active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Send message to content script to summarize the page
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'summarizePage',
            apiKey: apiKey,
            targetLevel: targetLevel
        });
        
        if (response.success) {
            showStatus(`Summary created and downloaded!`, 'success');
        } else {
            showStatus(`Error: ${response.error}`, 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
        console.error('Summarize error:', error);
    }
}

// Reset page to original content
async function resetPage() {
    showStatus('<span class="spinner"></span>Resetting page...', 'processing');
    
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'resetPage'
        });
        
        if (response.success) {
            showStatus('Page reset to original content', 'success');
        }
    } catch (error) {
        showStatus(`Error resetting page: ${error.message}`, 'error');
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', initPopup);