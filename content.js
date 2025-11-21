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
        
        // Extract main content from the page
        const textContent = extractMainContent();
        
        if (!textContent.trim()) {
            throw new Error('No readable text content found on this page');
        }
        
        // Send initial progress
        chrome.runtime.sendMessage({ action: 'progressUpdate', progress: 10 });
        
        // Process text in chunks to handle large pages
        const rewrittenContent = await processTextChunks(textContent, targetLevel, apiKey, 'rewrite');
        
        // Send progress update
        chrome.runtime.sendMessage({ action: 'progressUpdate', progress: 90 });
        
        // Replace the content on the page with proper text replacement
        replacePageContentWithRewrittenText(rewrittenContent);
        
        isRewritten = true;
        
        // Send completion progress
        chrome.runtime.sendMessage({ action: 'progressUpdate', progress: 100 });
        
        return { success: true, originalLength: textContent.length, newLength: rewrittenContent.length };
        
    } catch (error) {
        console.error('Content rewriting error:', error);
        return { success: false, error: error.message };
    }
}

// Process text in chunks for better rewriting
async function processTextChunks(text, targetLevel, apiKey, mode) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    let currentChunk = '';
    
    // Group sentences into chunks of 3-5 sentences each
    for (let i = 0; i < sentences.length; i++) {
        currentChunk += sentences[i] + '. ';
        if ((i + 1) % 4 === 0 || i === sentences.length - 1) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
        }
    }
    
    // Process each chunk with progress updates
    const processedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk.length > 50) { // Only process substantial chunks
            // Update progress
            const progress = 10 + Math.floor((i / chunks.length) * 80);
            chrome.runtime.sendMessage({ action: 'progressUpdate', progress: progress });
            
            const processed = mode === 'rewrite' 
                ? await rewriteTextWithOpenAI(chunk, targetLevel, apiKey)
                : await summarizeTextWithOpenAI(chunk, targetLevel, apiKey);
            processedChunks.push(processed);
        } else {
            processedChunks.push(chunk);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return processedChunks.join(' ');
}

// Enhanced text rewriting with better error handling
async function rewriteTextWithOpenAI(text, targetLevel, apiKey) {
    const prompt = `Rewrite the following text to match CEFR level ${targetLevel} English. 
    
IMPORTANT INSTRUCTIONS:
- Keep the exact same meaning and context
- Change only vocabulary and sentence structure to match ${targetLevel} level
- Maintain the original tone and style
- Return ONLY the rewritten text, no explanations

CEFR ${targetLevel} Guidelines: ${getLevelGuidelines(targetLevel)}

Original text: "${text}"

Rewritten text:`;

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
                        content: 'You are a professional text rewriter that adapts content to specific CEFR English levels while preserving exact meaning.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: Math.min(2000, text.length * 2),
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

// Replace page content with rewritten text while preserving layout
function replacePageContentWithRewrittenText(rewrittenContent) {
    const paragraphs = rewrittenContent.split(/\n\n+/);
    let currentParagraph = 0;
    
    // Create smooth transition
    document.body.style.transition = 'opacity 0.3s ease';
    document.body.style.opacity = '0.8';
    
    setTimeout(() => {
        // Replace content in stored elements while preserving structure
        originalTexts.forEach((item, index) => {
            if (currentParagraph < paragraphs.length && item.originalText.length > 20) {
                const newText = paragraphs[currentParagraph] || paragraphs[paragraphs.length - 1];
                
                // Always preserve HTML structure - only replace text content
                replaceTextContentPreservingStructure(item.element, newText);
                
                currentParagraph++;
            }
        });
        
        document.body.style.opacity = '1';
    }, 300);
}

// Replace text content while preserving all HTML structure and styling
function replaceTextContentPreservingStructure(element, newText) {
    // Store original styles and classes
    const originalClass = element.className;
    const originalStyle = element.style.cssText;
    
    // Replace only the text content, preserving all HTML structure
    if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
        // Simple case: element only contains text
        element.textContent = newText;
    } else {
        // Complex case: element contains other HTML
        // Find all text nodes and replace the first substantial one
        const textNodes = getTextNodes(element);
        if (textNodes.length > 0) {
            // Find the main text node (usually the first one with substantial content)
            let mainTextNode = textNodes[0];
            for (const node of textNodes) {
                if (node.textContent.trim().length > 10) {
                    mainTextNode = node;
                    break;
                }
            }
            mainTextNode.textContent = newText;
            
            // Remove other text nodes that might be whitespace or duplicates
            textNodes.forEach(node => {
                if (node !== mainTextNode && node.textContent.trim().length < 5) {
                    node.parentNode.removeChild(node);
                }
            });
        } else {
            // Fallback: append new text as a new node
            const textNode = document.createTextNode(newText);
            element.innerHTML = '';
            element.appendChild(textNode);
        }
    }
    
    // Restore original styles and classes
    element.className = originalClass;
    element.style.cssText = originalStyle;
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

// Create summary using OpenAI
async function createSummary(textContent, targetLevel, apiKey) {
    const wordCount = textContent.split(/\s+/).length;
    const targetWordCount = wordCount > 500 ? '500-600' : 'maximum 100';
    
    const prompt = `Create a ${targetWordCount} word summary of the following text at CEFR ${targetLevel} level.

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
                        content: 'You are a professional summarizer that creates concise summaries at specific CEFR English levels.'
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
        main p, main h1, main h2, main h3
    `);
    
    let index = 0;
    textElements.forEach((element) => {
        if (element.textContent && 
            element.textContent.trim().length > 25 && 
            isVisible(element) &&
            !isInNav(element)) {
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
    return element.closest('nav, .nav, .navigation, .menu, header, .header, footer, .footer');
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