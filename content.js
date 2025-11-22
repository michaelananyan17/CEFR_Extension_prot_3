// Content script for text rewriting and summarization
let originalTexts = new Map();
let isRewritten = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'rewritePage') {
        rewritePageContent(request.apiKey, request.targetLevel)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'summarizePage') {
        summarizePageContent(request.apiKey, request.targetLevel)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    
    if (request.action === 'resetPage') {
        resetPageContent();
        sendResponse({ success: true });
    }
    
    if (request.action === 'updateProgress') {
        sendResponse({ success: true });
    }
});

// ========== REWRITE PAGE FUNCTIONALITY ==========

// Main function to rewrite page content
async function rewritePageContent(apiKey, targetLevel) {
    try {
        // Store original texts if not already stored
        if (!isRewritten) {
            storeOriginalTexts();
        }
        
        // Send initial progress
        chrome.runtime.sendMessage({ action: 'progressUpdate', progress: 10 });
        
        // Process each text element individually to preserve structure
        await rewriteTextElements(targetLevel, apiKey);
        
        isRewritten = true;
        
        // Send completion progress
        chrome.runtime.sendMessage({ action: 'progressUpdate', progress: 100 });
        
        return { success: true, elementsRewritten: originalTexts.size };
        
    } catch (error) {
        console.error('Content rewriting error:', error);
        return { success: false, error: error.message };
    }
}

// Rewrite text elements individually while preserving structure
async function rewriteTextElements(targetLevel, apiKey) {
    const totalElements = originalTexts.size;
    let processedElements = 0;
    
    for (let [index, item] of originalTexts) {
        const originalText = item.originalText;
        
        if (originalText.trim().length > 10) { // Only process substantial text
            try {
                // Update progress
                const progress = 10 + Math.floor((processedElements / totalElements) * 80);
                chrome.runtime.sendMessage({ action: 'progressUpdate', progress: progress });
                
                // Rewrite this specific text element
                const rewrittenText = await rewriteTextWithOpenAI(originalText, targetLevel, apiKey);
                
                // Replace the text content while preserving all HTML structure
                replaceElementTextContent(item.element, rewrittenText);
                
            } catch (error) {
                console.error(`Error rewriting element ${index}:`, error);
                // Keep original text if rewriting fails
            }
        }
        
        processedElements++;
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

// Enhanced text rewriting with strict output control
async function rewriteTextWithOpenAI(text, targetLevel, apiKey) {
    const cleanText = text.trim().replace(/\s+/g, ' ').substring(0, 2000);
    
    // FIX FOR BUG 2: Prompt includes instruction to preserve symbols
    const prompt = `Rewrite this text to CEFR level ${targetLevel}.

RULES:
1. OUTPUT ONLY THE REWRITTEN TEXT. DO NOT REPEAT THE ORIGINAL.
2. Preserve proper names, locations, and quotes exactly.
3. Keep all parenthesis (), brackets [], and bullet points.
4. Maintain the same tone.

Input: "${cleanText}"`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a strict text replacement engine. You output only the result. You never repeat the input.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: Math.min(3000, cleanText.length * 3),
                temperature: 0.3
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        let rewrittenText = data.choices[0].message.content.trim();
        
        if (!rewrittenText) {
            throw new Error('OpenAI returned empty response');
        }

        // FIX FOR BUG 1: Fuzzy cleaning to remove original text if appended
        return cleanRewrittenText(rewrittenText, cleanText);
        
    } catch (error) {
        console.error('OpenAI API Error:', error);
        return text; // Return original text if API fails
    }
}

// Helper function to detect and remove original text from output
function cleanRewrittenText(rewritten, original) {
    // Normalize strings (remove whitespace and punctuation) to check for content repetition
    // regardless of minor formatting differences
    const normalize = (str) => str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    
    const normRewritten = normalize(rewritten);
    const normOriginal = normalize(original);

    // If the rewritten text ends with the original text (common hallucination)
    if (normRewritten.length > normOriginal.length && normRewritten.endsWith(normOriginal)) {
        // We need to find where the original text starts in the raw string to cut it off
        // Heuristic: split by double newline or assume the second half is the copy
        const splitParts = rewritten.split(/\n+/);
        if (splitParts.length > 1) {
            // Return the first part as the rewrite
            return splitParts[0].trim();
        }
    }

    // Fallback: if it contains the exact string (rare but possible)
    if (rewritten.includes(original) && rewritten.length > original.length * 1.2) {
        return rewritten.replace(original, '').trim();
    }

    return rewritten;
}

// Replace element text content while strictly enforcing visual styles
function replaceElementTextContent(element, newText) {
    // FIX FOR BUG 3: Capture ALL typography styles
    const computedStyle = window.getComputedStyle(element);
    
    // We capture these specifically to fix the "slanted/bold" issue
    const forcedStyles = {
        fontSize: computedStyle.fontSize,
        fontFamily: computedStyle.fontFamily,
        fontWeight: computedStyle.fontWeight,      // Handles Bold
        fontStyle: computedStyle.fontStyle,        // Handles Slanted/Italic
        textDecoration: computedStyle.textDecoration, // Handles Underline
        textTransform: computedStyle.textTransform,
        lineHeight: computedStyle.lineHeight,
        color: computedStyle.color,
        textAlign: computedStyle.textAlign,
        letterSpacing: computedStyle.letterSpacing
    };

    // Store original styles for reset functionality
    const originalClass = element.className;
    const originalStyle = element.style.cssText;
    const originalAttributes = {};
    
    ['id', 'style', 'class', 'data-*'].forEach(attr => {
        if (element.hasAttribute(attr)) {
            originalAttributes[attr] = element.getAttribute(attr);
        }
    });
    
    // Visual transition
    element.style.transition = 'opacity 0.3s ease';
    element.style.opacity = '0.7';
    
    setTimeout(() => {
        // Logic to replace text while preserving minimal structure
        if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
            element.textContent = newText;
        } else {
            const textNodes = getTextNodes(element);
            if (textNodes.length > 0) {
                let mainTextNode = textNodes.find(node => 
                    node.textContent.trim().length > 10 && 
                    !node.parentElement.tagName.match(/^(SCRIPT|STYLE|NOSCRIPT)$/i)
                ) || textNodes[0];
                
                if (mainTextNode) {
                    mainTextNode.textContent = newText;
                    // Cleanup small fragments
                    textNodes.forEach(node => {
                        if (node !== mainTextNode && node.textContent.trim().length < 5) {
                            node.parentNode.removeChild(node);
                        }
                    });
                } else {
                    const textNode = document.createTextNode(newText);
                    element.innerHTML = '';
                    element.appendChild(textNode);
                }
            } else {
                const textNode = document.createTextNode(newText);
                element.innerHTML = '';
                element.appendChild(textNode);
            }
        }
        
        // Restore base attributes
        element.className = originalClass;
        element.style.cssText = originalStyle;
        
        Object.keys(originalAttributes).forEach(attr => {
            element.setAttribute(attr, originalAttributes[attr]);
        });
        
        // CRITICAL FIX: Re-apply the captured typography styles
        // This forces the element to look exactly like it did, including bold/italics
        element.style.fontSize = forcedStyles.fontSize;
        element.style.fontFamily = forcedStyles.fontFamily;
        element.style.fontWeight = forcedStyles.fontWeight;
        element.style.fontStyle = forcedStyles.fontStyle; // Fix for slanted text
        element.style.textDecoration = forcedStyles.textDecoration;
        element.style.textTransform = forcedStyles.textTransform;
        element.style.lineHeight = forcedStyles.lineHeight;
        element.style.color = forcedStyles.color;
        element.style.textAlign = forcedStyles.textAlign;
        
        element.style.opacity = '1';
    }, 150);
}

// ========== SUMMARIZE PAGE FUNCTIONALITY ==========

// Main function to summarize page content
async function summarizePageContent(apiKey, targetLevel) {
    try {
        const textContent = extractMainContent();
        
        if (!textContent.trim()) {
            throw new Error('No readable text content found on this page');
        }
        
        const summary = await createSummary(textContent, targetLevel, apiKey);
        
        downloadSummaryAsText(summary, targetLevel);
        
        return { success: true, summaryLength: summary.length };
        
    } catch (error) {
        console.error('Content summarization error:', error);
        return { success: false, error: error.message };
    }
}

// Create summary using OpenAI
async function createSummary(textContent, targetLevel, apiKey) {
    const wordCount = textContent.split(/\s+/).length;
    const targetWordCount = wordCount > 500 ? '500-600' : 'maximum 100';
    
    const prompt = `Create a ${targetWordCount} word summary of the following text at CEFR ${targetLevel} level.

RESTRICTIONS:
1. Do NOT change or translate Names, Street Addresses, or Locations.
2. Do NOT change text inside quotation marks.
3. Use vocabulary appropriate for ${targetLevel}.

Text to summarize:
"${textContent.substring(0, 12000)}"

Summary (${targetLevel} level):`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a professional summarizer. You preserve proper nouns, addresses, and quotes exactly as they are.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 800,
                temperature: 0.5
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content.trim();
        
    } catch (error) {
        console.error('OpenAI Summary Error:', error);
        throw new Error(`Failed to create summary: ${error.message}`);
    }
}

// Download summary as text file
function downloadSummaryAsText(summary, targetLevel) {
    const websiteName = document.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const filename = `${websiteName}_${targetLevel}_summary.txt`;
    
    const textContent = `
PAGE SUMMARY
============

Source: ${document.title}
URL: ${window.location.href}
CEFR Level: ${targetLevel}
Generated: ${new Date().toLocaleString()}

SUMMARY:
${summary}

---
Generated by Make it easy! Chrome Extension
    `;
    
    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ========== UTILITY FUNCTIONS ==========

// Store original text content
function storeOriginalTexts() {
    originalTexts.clear();
    
    const textElements = document.querySelectorAll(`
        p, h1, h2, h3, h4, h5, h6,
        article p, article h1, article h2, article h3,
        section p, section h1, section h2, section h3,
        .content p, .content h1, .content h2, .content h3,
        .article p, .article h1, .article h2, .article h3,
        .post p, .post h1, .post h2, .post h3,
        [role="article"] p, [role="article"] h1, [role="article"] h2,
        main p, main h1, main h2, main h3,
        div:not(nav):not(header):not(footer):not([class*="nav"]):not([class*="menu"]):not([class*="sidebar"])
    `);
    
    let index = 0;
    textElements.forEach((element) => {
        if (element.textContent && 
            element.textContent.trim().length > 25 && 
            isVisible(element) &&
            !isInNav(element) &&
            !isInteractive(element)) {
            originalTexts.set(index, {
                element: element,
                originalText: element.textContent,
                originalHTML: element.innerHTML
            });
            index++;
        }
    });
}

// Check if element is visible
function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0;
}

// Check if element is in navigation
function isInNav(element) {
    return element.closest('nav, .nav, .navigation, .menu, header, .header, footer, .footer, aside, .sidebar');
}

// Check if element is interactive
function isInteractive(element) {
    return element.tagName === 'BUTTON' || 
           element.tagName === 'A' ||
           element.getAttribute('role') === 'button' ||
           element.onclick != null;
}

// Extract main content from the page
function extractMainContent() {
    const contentSelectors = [
        'main',
        'article',
        '[role="main"]',
        '.content',
        '.main-content',
        '.post-content',
        '.article-content',
        '.story-content',
        '.entry-content'
    ];
    
    let mainContent = '';
    
    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && getTextContentLength(element) > 100) {
            mainContent = element.textContent;
            break;
        }
    }
    
    if (!mainContent || mainContent.length < 100) {
        const body = document.body.cloneNode(true);
        const excludeSelectors = [
            'nav', 'header', 'footer', '.nav', '.header', '.footer', 
            '.menu', '.sidebar', '.ad', '.advertisement', '.banner',
            'script', 'style', 'noscript', 'iframe'
        ];
        excludeSelectors.forEach(selector => {
            const elements = body.querySelectorAll(selector);
            elements.forEach(el => el.remove());
        });
        mainContent = body.textContent;
    }
    
    return cleanTextContent(mainContent);
}

function getTextContentLength(element) {
    return element.textContent.replace(/\s+/g, ' ').trim().length;
}

function cleanTextContent(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim()
        .substring(0, 12000);
}

function getLevelGuidelines(level) {
    const guidelines = {
        'A1': 'Use very basic phrases and simple vocabulary. Short sentences. Everyday expressions.',
        'A2': 'Use basic sentences and common vocabulary. Direct communication about familiar topics.',
        'B1': 'Use clear standard language. Can handle main points on familiar topics. Straightforward connected text.',
        'B2': 'Use more complex sentences and vocabulary. Can handle abstract and technical topics.',
        'C1': 'Use sophisticated language and complex structures. Fluent and precise expression.',
        'C2': 'Use highly sophisticated language with nuance and precision. Native-like fluency.'
    };
    
    return guidelines[level] || 'Use appropriate language for the specified level.';
}

function getTextNodes(element) {
    const textNodes = [];
    function findTextNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else {
            node.childNodes.forEach(findTextNodes);
        }
    }
    findTextNodes(element);
    return textNodes;
}

function resetPageContent() {
    if (!isRewritten) return;
    
    originalTexts.forEach(item => {
        item.element.innerHTML = item.originalHTML;
        // Reset any forced styles
        item.element.style.fontSize = '';
        item.element.style.fontFamily = '';
        item.element.style.fontWeight = '';
        item.element.style.fontStyle = ''; // Reset italics
        item.element.style.textDecoration = ''; // Reset underline
        item.element.style.lineHeight = '';
        item.element.style.color = '';
        item.element.style.textAlign = '';
    });
    
    isRewritten = false;
    
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 300);
}
