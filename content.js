[file name]: content.js
[file content begin]
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
        // Could be used for progress updates in future
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

// Enhanced text rewriting with entity protection
async function rewriteTextWithOpenAI(text, targetLevel, apiKey) {
    // Clean the text for processing
    const cleanText = text.trim().replace(/\s+/g, ' ').substring(0, 2000);
    
    // Extract protected entities from the text
    const protectedEntities = extractProtectedEntities(cleanText);
    
    const prompt = `Rewrite the following text to match CEFR level ${targetLevel} English, BUT follow these CRITICAL rules:

MANDATORY RULES:
1. Keep the exact same meaning and context
2. Change only vocabulary and sentence structure to match ${targetLevel} level
3. Maintain the original tone and style
4. Return ONLY the rewritten text, no explanations
5. Keep the same overall length
6. NEVER change or rewrite these specific elements - keep them EXACTLY as written:
   - QUOTES: Anything in quotation marks ""
   - NAMES: Person names, brand names, product names
   - ADDRESSES: Street addresses, cities, countries, zip codes
   - LOCATIONS: Place names, landmarks, buildings
   - DATES: Any date format (January 1, 2024 or 01/01/2024)
   - NUMBERS: Any numerical values, percentages, prices
   - TECHNICAL TERMS: Domain-specific terminology
   - PROPER NOUNS: Any capitalized specific names

PROTECTED ENTITIES THAT MUST REMAIN UNCHANGED:
${protectedEntities.map(entity => `- "${entity.text}" (type: ${entity.type})`).join('\n')}

CEFR ${targetLevel} Guidelines: ${getLevelGuidelines(targetLevel)}

Original text: "${cleanText}"

Rewritten text (with protected entities unchanged):`;

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
                        content: 'You are a professional text rewriter that adapts content to specific CEFR English levels while preserving exact meaning, tone, and context. You MUST preserve protected entities exactly as written.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: Math.min(2500, cleanText.length * 2),
                temperature: 0.3 // Lower temperature for more consistent rewriting
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        const rewrittenText = data.choices[0].message.content.trim();
        
        if (!rewrittenText) {
            throw new Error('OpenAI returned empty response');
        }
        
        return rewrittenText;
        
    } catch (error) {
        console.error('OpenAI API Error:', error);
        return text; // Return original text if API fails
    }
}

// Function to identify and extract protected entities
function extractProtectedEntities(text) {
    const entities = [];
    
    // Extract quotes (anything between quotation marks)
    const quoteMatches = text.match(/"[^"]+"/g) || [];
    quoteMatches.forEach(quote => {
        entities.push({ type: 'QUOTE', text: quote });
    });
    
    // Extract names (capitalized words in specific contexts)
    const nameMatches = text.match(/\b[A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
    nameMatches.forEach(name => {
        // Avoid matching sentence starters
        if (!name.match(/^(The|A|An|This|That|These|Those|In|On|At)\b/)) {
            entities.push({ type: 'NAME', text: name });
        }
    });
    
    // Extract addresses (street patterns)
    const addressMatches = text.match(/\b\d+\s+[A-Za-z0-9]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl)\b/gi) || [];
    addressMatches.forEach(address => {
        entities.push({ type: 'ADDRESS', text: address });
    });
    
    // Extract locations (common location indicators)
    const locationMatches = text.match(/\b(?:[A-Z][a-z]+\s)+(?:City|Town|Village|County|State|Country|Park|Lake|River|Mountain|Mount|Beach|Island)\b/g) || [];
    locationMatches.forEach(location => {
        entities.push({ type: 'LOCATION', text: location });
    });
    
    // Extract dates (common date formats)
    const dateMatches = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [];
    dateMatches.forEach(date => {
        entities.push({ type: 'DATE', text: date });
    });
    
    // Extract numbers with symbols (prices, percentages)
    const numberMatches = text.match(/\$\d+(?:\.\d+)?|\d+(?:\.\d+)?%|\d+\.\d+/g) || [];
    numberMatches.forEach(number => {
        entities.push({ type: 'NUMBER', text: number });
    });
    
    return entities;
}

// Replace element text content while preserving all HTML structure and styling
function replaceElementTextContent(element, newText) {
    // Store the original HTML structure EXACTLY as it was
    const originalHTML = element.innerHTML;
    const originalClass = element.className;
    const originalStyle = element.style.cssText;
    const originalAttributes = {};
    
    // Store important attributes
    ['id', 'style', 'class', 'data-*'].forEach(attr => {
        if (element.hasAttribute(attr)) {
            originalAttributes[attr] = element.getAttribute(attr);
        }
    });
    
    // Create smooth transition
    element.style.transition = 'opacity 0.3s ease';
    element.style.opacity = '0.7';
    
    setTimeout(() => {
        // COMPLETELY NEW APPROACH: Use the original HTML structure but replace text content
        // This preserves ALL formatting while ensuring no double text
        
        // First, restore the original HTML structure exactly
        element.innerHTML = originalHTML;
        
        // Now replace text content while preserving HTML tags
        const textNodes = getTextNodes(element);
        
        if (textNodes.length === 0) {
            // If no text nodes found, use simple replacement
            element.textContent = newText;
        } else if (textNodes.length === 1) {
            // Simple case: only one text node
            textNodes[0].textContent = newText;
        } else {
            // Complex case: multiple text nodes - find the main content node
            let mainTextNode = null;
            let maxLength = 0;
            
            textNodes.forEach(node => {
                const textLength = node.textContent.trim().length;
                if (textLength > maxLength && textLength > 10) {
                    mainTextNode = node;
                    maxLength = textLength;
                }
            });
            
            if (mainTextNode) {
                // Replace the main text node with new content
                mainTextNode.textContent = newText;
                
                // Remove other text nodes to prevent double text
                textNodes.forEach(node => {
                    if (node !== mainTextNode && node.parentNode) {
                        node.textContent = ''; // Clear content but keep node to preserve structure
                    }
                });
            } else {
                // Fallback: replace entire content
                element.textContent = newText;
            }
        }
        
        // Restore original styles and classes EXACTLY
        element.className = originalClass;
        element.style.cssText = originalStyle;
        
        // Restore attributes
        Object.keys(originalAttributes).forEach(attr => {
            element.setAttribute(attr, originalAttributes[attr]);
        });
        
        element.style.opacity = '1';
    }, 150);
}

// ========== SUMMARIZE PAGE FUNCTIONALITY ==========

// Main function to summarize page content
async function summarizePageContent(apiKey, targetLevel) {
    try {
        // Extract main content from the page
        const textContent = extractMainContent();
        
        if (!textContent.trim()) {
            throw new Error('No readable text content found on this page');
        }
        
        // Create summary
        const summary = await createSummary(textContent, targetLevel, apiKey);
        
        // Download as text file instead of PDF to avoid binary issues
        downloadSummaryAsText(summary, targetLevel);
        
        return { success: true, summaryLength: summary.length };
        
    } catch (error) {
        console.error('Content summarization error:', error);
        return { success: false, error: error.message };
    }
}

// Create summary using OpenAI with entity protection
async function createSummary(textContent, targetLevel, apiKey) {
    const wordCount = textContent.split(/\s+/).length;
    const targetWordCount = wordCount > 500 ? '500-600' : 'maximum 100';
    
    // Extract protected entities for the summary too
    const protectedEntities = extractProtectedEntities(textContent);
    
    const prompt = `Create a ${targetWordCount} word summary of the following text at CEFR ${targetLevel} level.

IMPORTANT: Preserve these exact elements without change:
${protectedEntities.map(entity => `- ${entity.text} (${entity.type})`).join('\n')}

CEFR ${targetLevel} Guidelines: ${getLevelGuidelines(targetLevel)}

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
                        content: 'You are a professional summarizer that creates concise summaries at specific CEFR English levels while preserving protected entities.'
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

// Download summary as text file (fix for PDF binary issue)
function downloadSummaryAsText(summary, targetLevel) {
    const websiteName = document.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    const filename = `${websiteName}_${targetLevel}_summary.txt`;
    
    // Create text content with proper formatting
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
    
    // Create blob and download
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

// Store original text content with better element selection
function storeOriginalTexts() {
    originalTexts.clear();
    
    // More selective element targeting to preserve layout
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
    
    // Try to find main content containers first
    for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element && getTextContentLength(element) > 100) {
            mainContent = element.textContent;
            break;
        }
    }
    
    // If no main content found, use body text but exclude navigation
    if (!mainContent || mainContent.length < 100) {
        const body = document.body.cloneNode(true);
        
        // Remove common navigation and non-content elements
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
    
    // Clean up the text
    return cleanTextContent(mainContent);
}

// Get text content length
function getTextContentLength(element) {
    return element.textContent.replace(/\s+/g, ' ').trim().length;
}

// Clean text content
function cleanTextContent(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim()
        .substring(0, 12000); // Limit to avoid token limits
}

// Get CEFR level guidelines
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

// Get text nodes from an element
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

// Reset page to original content
function resetPageContent() {
    if (!isRewritten) return;
    
    originalTexts.forEach(item => {
        item.element.innerHTML = item.originalHTML;
    });
    
    isRewritten = false;
    
    // Smooth transition
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 300);
}
