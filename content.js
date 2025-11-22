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
                
                // Replace the text content while strictly preserving visuals
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

// Enhanced text rewriting with strict constraints
async function rewriteTextWithOpenAI(text, targetLevel, apiKey) {
    // Clean the text for processing
    const cleanText = text.trim().replace(/\s+/g, ' ').substring(0, 2000);
    
    // STRICT PROMPT ENGINEERING TO FIX BUGS 1 & 2
    const prompt = `Task: Rewrite the following text to match CEFR level ${targetLevel} English.

CRITICAL RULES (MUST FOLLOW):
1. Output ONLY the rewritten text. Do NOT include the original text. Do NOT add "Here is the rewritten text" or any intro/outro.
2. STRICTLY PRESERVE ENTITIES:
   - Do NOT translate or modify proper names (people, companies, products).
   - Do NOT translate or modify Street Addresses or specific Locations.
   - Do NOT change text inside quotation marks (""). Keep quotes EXACTLY as they appear.
3. Maintain the exact same meaning, tone, and context.
4. Keep the same overall length (do not summarize).

Target CEFR Level: ${targetLevel}
Guidelines: ${getLevelGuidelines(targetLevel)}

Input Text:
"${cleanText}"

Rewritten Output:`;

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
                        content: 'You are a strict text rewriting engine. You never explain your output. You never repeat the input text. You strictly preserve names, addresses, and quotes.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: Math.min(2500, cleanText.length * 2),
                temperature: 0.2 // Lower temperature for precision and adherence to rules
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API Error: ${errorData.error?.message || 'Unknown error'}`);
        }
        
        const data = await response.json();
        let rewrittenText = data.choices[0].message.content.trim();
        
        // Final sanity check to prevent Bug 1 (repetition)
        // If the result contains the original text (longer than 50 chars), assume error and strip it or return just the new part
        if (cleanText.length > 50 && rewrittenText.includes(cleanText)) {
             rewrittenText = rewrittenText.replace(cleanText, '').trim();
        }
        
        if (!rewrittenText) {
            throw new Error('OpenAI returned empty response');
        }
        
        return rewrittenText;
        
    } catch (error) {
        console.error('OpenAI API Error:', error);
        return text; // Return original text if API fails
    }
}

// Replace element text content with MAXIMUM VISUAL MATCHING (Fix for Bug 3)
function replaceElementTextContent(element, newText) {
    // 1. Capture critical computed styles before touching the element
    // This ensures we don't lose font size/weight/family even if we lose internal span tags
    const computedStyle = window.getComputedStyle(element);
    const visualProps = {
        fontSize: computedStyle.fontSize,
        fontFamily: computedStyle.fontFamily,
        fontWeight: computedStyle.fontWeight,
        lineHeight: computedStyle.lineHeight,
        color: computedStyle.color,
        letterSpacing: computedStyle.letterSpacing,
        textAlign: computedStyle.textAlign,
        textTransform: computedStyle.textTransform
    };

    // Store original DOM attributes for restoration
    const originalClass = element.className;
    const originalStyle = element.style.cssText; // Inline styles
    const originalAttributes = {};
    
    ['id', 'data-*', 'role', 'aria-*'].forEach(attr => {
        if (element.hasAttribute(attr)) {
            originalAttributes[attr] = element.getAttribute(attr);
        }
    });
    
    // Visual transition
    element.style.transition = 'opacity 0.3s ease';
    element.style.opacity = '0.7';
    
    setTimeout(() => {
        // 2. Replace Content
        element.textContent = newText;
        
        // 3. Restore Attributes & Classes
        element.className = originalClass;
        element.style.cssText = originalStyle; // Restore inline styles
        
        Object.keys(originalAttributes).forEach(attr => {
            element.setAttribute(attr, originalAttributes[attr]);
        });
        
        // 4. FORCE VISUAL MATCHING
        // Apply the captured computed styles directly to the element to ensure strict visual adherence
        // This overrides any default browser reset that might happen when content changes
        element.style.fontSize = visualProps.fontSize;
        element.style.fontFamily = visualProps.fontFamily;
        element.style.fontWeight = visualProps.fontWeight;
        element.style.lineHeight = visualProps.lineHeight;
        element.style.color = visualProps.color;
        element.style.textAlign = visualProps.textAlign;

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
    
    // Update prompt to respect entities in summaries as well
    const prompt = `Create a ${targetWordCount} word summary of the following text at CEFR ${targetLevel} level.

IMPORTANT RESTRICTIONS:
1. Do NOT translate or change Names, Street Addresses, or specific Locations. Keep them exact.
2. Do NOT translate quotes if used.
3. Use vocabulary matching CEFR ${targetLevel}.

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
                        content: 'You are a professional summarizer. You preserve proper nouns, addresses, and locations exactly as they appear in the source.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 800,
                temperature: 0.4
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

function storeOriginalTexts() {
    originalTexts.clear();
    
    // Selector strategy: target block elements containing text
    const textElements = document.querySelectorAll(`
        p, h1, h2, h3, h4, h5, h6, li, blockquote,
        article p, section p, .content p, .post p, main p,
        div:not(:has(div))
    `);
    
    let index = 0;
    textElements.forEach((element) => {
        // Filter out empty or hidden elements
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

function isVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetWidth > 0 &&
           element.offsetHeight > 0;
}

function isInNav(element) {
    return element.closest('nav, .nav, .navigation, .menu, header, .header, footer, .footer, aside, .sidebar');
}

function isInteractive(element) {
    return element.tagName === 'BUTTON' || 
           element.tagName === 'A' ||
           element.closest('a') || 
           element.getAttribute('role') === 'button' ||
           element.onclick != null;
}

function extractMainContent() {
    const contentSelectors = [
        'main', 'article', '[role="main"]', '.content', '.main-content', 
        '.post-content', '.article-content', '.entry-content'
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
            '.menu', '.sidebar', '.ad', 'script', 'style', 'noscript', 'iframe'
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

function resetPageContent() {
    if (!isRewritten) return;
    
    originalTexts.forEach(item => {
        item.element.innerHTML = item.originalHTML;
        // Reset explicitly set styles to allow original CSS to take over
        item.element.style.fontSize = '';
        item.element.style.fontFamily = '';
        item.element.style.fontWeight = '';
        item.element.style.lineHeight = '';
        item.element.style.color = '';
    });
    
    isRewritten = false;
    
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 300);
}
