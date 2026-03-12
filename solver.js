// ===========================================
// EMAKTAB TEST SOLVER - Full Version
// ===========================================
// Paste this entire code into browser console (F12) when on test page

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        GEMINI_API_KEY: prompt("Enter your Gemini API Key:"),
        MODEL: "gemini-3.1-pro-preview",
        HIGHLIGHT_COLOR: "#ffeb3b",
        SELECTED_COLOR: "#4caf50",
        AUTO_SELECT: confirm("Auto-select answers after solving? Click OK for Yes, Cancel for No"),
        SHOW_REASONING: confirm("Show AI reasoning in console? Click OK for Yes, Cancel for No")
    };

    if (!CONFIG.GEMINI_API_KEY) {
        alert("❌ No API key provided. Exiting.");
        return;
    }

    // State
    let questions = [];
    let solutions = [];
    let panel = null;

    // Helper functions
    const cleanText = (s) => (s || "").replace(/\s+/g, " ").trim();

    // Create UI panel
    function createUIPanel() {
        panel = document.createElement('div');
        panel.id = 'emaktab-solver-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 350px;
            max-height: 80vh;
            background: white;
            border: 2px solid #2196F3;
            border-radius: 10px;
            padding: 15px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 999999;
            font-family: Arial, sans-serif;
            overflow-y: auto;
            color: #333;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 2px solid #eee; padding-bottom: 10px;">
                <h3 style="margin: 0; color: #2196F3;">📝 Emaktab Test Solver</h3>
                <button id="close-panel" style="background: none; border: none; font-size: 20px; cursor: pointer;">✖</button>
            </div>
            <div id="solver-status" style="margin-bottom: 15px; padding: 10px; background: #e3f2fd; border-radius: 5px;">
                Ready to start. Model: ${CONFIG.MODEL}
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                <button id="extract-questions" style="flex: 1; padding: 8px; background: #4caf50; color: white; border: none; border-radius: 5px; cursor: pointer;">📋 Extract</button>
                <button id="solve-all" style="flex: 1; padding: 8px; background: #2196F3; color: white; border: none; border-radius: 5px; cursor: pointer;">🤖 Solve All</button>
                <button id="select-answers" style="flex: 1; padding: 8px; background: #ff9800; color: white; border: none; border-radius: 5px; cursor: pointer;">🎯 Select</button>
            </div>
            <div style="display: flex; gap: 5px; margin-bottom: 15px;">
                <button id="export-data" style="flex: 1; padding: 5px; background: #9c27b0; color: white; border: none; border-radius: 5px; cursor: pointer;">📤 Export</button>
                <button id="clear-all" style="flex: 1; padding: 5px; background: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer;">🗑️ Clear</button>
            </div>
            <div id="questions-list" style="max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 5px;">
                No questions extracted yet. Click "Extract" to start.
            </div>
            <div style="margin-top: 15px; font-size: 12px; color: #999; text-align: center;">
                Auto-select: ${CONFIG.AUTO_SELECT ? '✅' : '❌'} | Show reasoning: ${CONFIG.SHOW_REASONING ? '✅' : '❌'}
            </div>
        `;

        document.body.appendChild(panel);

        // Event listeners
        document.getElementById('close-panel').onclick = () => panel.remove();
        document.getElementById('extract-questions').onclick = extractQuestions;
        document.getElementById('solve-all').onclick = solveAllQuestions;
        document.getElementById('select-answers').onclick = selectAnswers;
        document.getElementById('export-data').onclick = exportData;
        document.getElementById('clear-all').onclick = clearAll;

        // Keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                extractQuestions();
            }
        });

        console.log('✅ Emaktab Solver loaded! Panel created on right side.');
    }

    // Update status
    function updateStatus(message, type = 'info') {
        const status = document.getElementById('solver-status');
        if (status) {
            const colors = {
                info: '#e3f2fd',
                success: '#c8e6c9',
                error: '#ffcdd2',
                warning: '#fff3e0'
            };
            status.style.background = colors[type] || colors.info;
            status.innerHTML = message;
        }
        console.log(`[${type.toUpperCase()}] ${message}`);
    }

    // Extract questions
    function extractQuestions() {
        questions = [];
        const blocks = document.querySelectorAll('[data-test-id^="block-"]');
        
        if (blocks.length === 0) {
            updateStatus('❌ No question blocks found!', 'error');
            return;
        }

        updateStatus(`Found ${blocks.length} question blocks...`, 'info');

        blocks.forEach((block, index) => {
            block.style.outline = `3px solid ${CONFIG.HIGHLIGHT_COLOR}`;
            block.style.outlineOffset = '2px';

            const questionText = cleanText(block.innerText);
            const options = block.querySelectorAll('[data-test-id^="answer-"]');
            const dropdowns = block.querySelectorAll('.DtVSJ.dbzdF');
            
            // Check if it's a matching question
            const isMatchingQuestion = block.querySelectorAll('.YBX37.bdL_6').length > 0;
            
            // Check if it's a table-based biology question (like protein synthesis)
            const isTableQuestion = questionText.includes('jadval') || 
                                    (questionText.includes('zanjir') && 
                                     questionText.includes('antikodon') && 
                                     questionText.includes('aminokislota'));

            const question = {
                index: index,
                block: block,
                text: questionText,
                type: isMatchingQuestion ? 'matching' : 
                      (isTableQuestion ? 'biology-table' : 
                       (options.length > 0 ? 'choice' : 
                        (dropdowns.length > 0 ? 'dropdown' : 'unknown'))),
                options: [],
                dropdowns: [],
                matchingPairs: [],
                tableData: null
            };

            if (isTableQuestion) {
                // Try to extract table data
                const tableElements = block.querySelectorAll('table, tr, td, ._ZhFj');
                const tableText = block.innerText;
                
                // Extract the DNA sequence
                const dnaMatch = tableText.match(/[ATCG]{3}/);
                const dnaSequence = dnaMatch ? dnaMatch[0] : null;
                
                // Extract amino acid
                const aaMatch = tableText.match(/(gistidin|izoleysin|tirozin|arginin|serin)/i);
                const aminoAcid = aaMatch ? aaMatch[0].toLowerCase() : null;
                
                // Extract possible antikodon options
                const options = tableText.match(/[ATCG]{3}/g) || [];
                
                question.tableData = {
                    dnaSequence: dnaSequence,
                    aminoAcid: aminoAcid,
                    options: options.filter(opt => opt !== dnaSequence)
                };
                
                // Also get the actual option elements
                options.forEach(opt => {
                    const optionElements = Array.from(block.querySelectorAll('[data-test-id^="answer-"]'));
                    optionElements.forEach(el => {
                        if (cleanText(el.innerText).includes(opt)) {
                            question.options.push({
                                element: el,
                                text: opt
                            });
                        }
                    });
                });
            } else if (isMatchingQuestion) {
                const items = block.querySelectorAll('.YBX37.bdL_6');
                items.forEach(item => {
                    const text = cleanText(item.innerText);
                    const hasFormula = /[A-Z][a-z]?\d*/.test(text) && 
                                      !text.includes('Kristall') && 
                                      !text.includes('Ichimlik') && 
                                      !text.includes('Suvsiz') && 
                                      !text.includes('Kaustik');
                    question.matchingPairs.push({
                        element: item,
                        text: text,
                        isFormula: hasFormula,
                        formula: hasFormula ? text : null,
                        name: !hasFormula ? text : null
                    });
                });
            } else if (options.length > 0) {
                options.forEach(opt => {
                    question.options.push({
                        element: opt,
                        text: cleanText(opt.innerText)
                    });
                });
            } else if (dropdowns.length > 0) {
                dropdowns.forEach(dd => {
                    question.dropdowns.push({
                        element: dd,
                        currentValue: cleanText(dd.innerText)
                    });
                });
            }

            questions.push(question);
        });

        renderQuestionsList();
        updateStatus(`✅ Extracted ${questions.length} questions`, 'success');
        
        // Auto copy to clipboard
        const summary = questions.map(q => ({
            index: q.index,
            text: q.text.substring(0, 100) + '...',
            type: q.type,
            options: q.options.map(o => o.text),
            blanks: q.dropdowns.length,
            matchingPairs: q.matchingPairs.length,
            tableData: q.tableData
        }));
        copyToClipboard(JSON.stringify(summary, null, 2));
    }

    // Render questions list
    function renderQuestionsList() {
        const listDiv = document.getElementById('questions-list');
        if (!listDiv) return;

        if (questions.length === 0) {
            listDiv.innerHTML = 'No questions extracted yet.';
            return;
        }

        let html = '';
        questions.forEach((q, i) => {
            const solved = solutions.find(s => s.index === i);
            const status = solved ? (solved.solution ? '✅' : '❌') : '⏳';
            
            html += `
                <div style="margin-bottom: 15px; padding: 10px; background: #f5f5f5; border-radius: 5px; border-left: 4px solid ${solved ? '#4caf50' : '#ff9800'}">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <strong>Q${i + 1} ${status}</strong>
                        <span style="font-size: 11px; background: #e0e0e0; padding: 2px 5px; border-radius: 3px;">${q.type}</span>
                    </div>
                    <div style="font-size: 12px; margin-bottom: 5px; max-height: 60px; overflow: hidden;">
                        ${q.text.substring(0, 100)}...
                    </div>
                    ${solved ? `
                        <div style="font-size: 11px; background: #e8f5e8; padding: 5px; border-radius: 3px; margin-bottom: 5px;">
                            <strong>Solution:</strong> ${solved.solution}
                        </div>
                    ` : ''}
                    <button class="solve-single" data-index="${i}" style="margin-right: 5px; padding: 3px 8px; background: #2196F3; color: white; border: none; border-radius: 3px; font-size: 11px; cursor: pointer;">
                        Solve
                    </button>
                    <button class="select-single" data-index="${i}" style="padding: 3px 8px; background: #ff9800; color: white; border: none; border-radius: 3px; font-size: 11px; cursor: pointer;">
                        Select
                    </button>
                </div>
            `;
        });

        listDiv.innerHTML = html;

        // Add event listeners
        document.querySelectorAll('.solve-single').forEach(btn => {
            btn.onclick = () => solveQuestion(parseInt(btn.dataset.index));
        });
        document.querySelectorAll('.select-single').forEach(btn => {
            btn.onclick = () => selectSingleAnswer(parseInt(btn.dataset.index));
        });
    }

    // Extract text from Gemini response
    function extractGeminiResponse(data) {
        try {
            if (data.candidates && data.candidates.length > 0) {
                const candidate = data.candidates[0];
                
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    return candidate.content.parts[0].text;
                } else if (candidate.content && candidate.content.text) {
                    return candidate.content.text;
                } else if (candidate.parts && candidate.parts.length > 0) {
                    return candidate.parts[0].text;
                } else if (candidate.text) {
                    return candidate.text;
                } else if (candidate.output) {
                    return candidate.output;
                }
            }
            
            return "[No text content in response]";
            
        } catch (error) {
            console.error('Error extracting response:', error);
            return '[Error extracting response]';
        }
    }

    // Solve single question
    async function solveQuestion(index) {
        const question = questions[index];
        if (!question) return;

        updateStatus(`🤔 Solving question ${index + 1}...`, 'info');
        question.block.style.outline = '3px solid #ff9800';

        try {
            let prompt = "";
            let maxTokens = 4096;
            
            if (question.type === "choice") {
                prompt = `You are solving a multiple choice test question. 
Question: ${question.text}
Options:
${question.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt.text}`).join('\n')}

Provide ONLY the letter of the correct answer (A, B, C, or D).`;
                maxTokens = 1024;
            } 
            else if (question.type === "biology-table") {
                // Special handling for biology table questions
                const tableData = question.tableData || {};
                prompt = `You are solving a biology/protein synthesis question.

Question: ${question.text}

DNA sequence: ${tableData.dnaSequence || 'unknown'}
Given amino acid: ${tableData.aminoAcid || 'unknown'}

Genetic code provided in the question:
- CAC — gistidin
- AUA — izoleysin
- UAU — tirozin
- AGG — arginin
- UCC — serin

To solve:
1. DNA sequence is given as the "2-zanjir" (second strand)
2. If this is the second strand, first transcribe to mRNA (DNA A→U, T→A, C→G, G→C)
3. Then find which codon codes for the given amino acid
4. The antikodon is complementary to the codon (mRNA codon ↔ tRNA antikodon)

First, transcribe the DNA "${tableData.dnaSequence}" to mRNA, then find what antikodon would bring the amino acid "${tableData.aminoAcid}".

Provide the answer in this format: "The correct antikodon is XXX" where XXX is the 3-letter code.`;
                maxTokens = 2048;
            }
            else if (question.type === "dropdown") {
                prompt = `You are solving a fill-in-the-blanks test question with ${question.dropdowns.length} blanks.
Question: ${question.text}

Provide ONLY the answers as a comma-separated list (e.g., answer1, answer2, answer3).`;
                maxTokens = 2048;
            }
            else if (question.type === "matching") {
                const names = question.matchingPairs.filter(p => !p.isFormula).map(p => p.text);
                const formulas = question.matchingPairs.filter(p => p.isFormula).map(p => p.text);
                
                prompt = `You are solving a chemistry matching question. Match each name with its correct chemical formula.

Names:
${names.map((name, idx) => `${idx + 1}. ${name}`).join('\n')}

Formulas:
${formulas.map((formula, idx) => `${String.fromCharCode(65 + idx)}. ${formula}`).join('\n')}

Provide the matches in this format: "1-A, 2-B, 3-C" (where number is the name and letter is the formula).`;
                maxTokens = 4096;
            }

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ 
                        parts: [{ 
                            text: prompt 
                        }] 
                    }],
                    generationConfig: { 
                        temperature: 0.1, // Lower temperature for more consistent answers
                        maxOutputTokens: maxTokens,
                        topP: 0.8
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error.message);
            }

            let aiResponse = extractGeminiResponse(data);
            
            // Special parsing for biology questions
            let solution = aiResponse;
            if (question.type === "biology-table") {
                // Try to extract the antikodon from the response
                const antikodonMatch = aiResponse.match(/[ATCG]{3}/);
                if (antikodonMatch) {
                    solution = antikodonMatch[0];
                } else {
                    // If no 3-letter code found, check if it matches any option
                    if (question.options.length > 0) {
                        const optionTexts = question.options.map(o => o.text);
                        const foundOption = optionTexts.find(opt => aiResponse.includes(opt));
                        if (foundOption) {
                            solution = foundOption;
                        }
                    }
                }
            } else if (question.type === "choice") {
                const letterMatch = aiResponse.match(/\b([A-D])\b/);
                if (letterMatch) {
                    solution = letterMatch[1];
                }
            }

            // Remove existing solution if any
            solutions = solutions.filter(s => s.index !== index);
            
            // Add new solution
            solutions.push({
                index: index,
                type: question.type,
                solution: solution,
                fullResponse: aiResponse,
                timestamp: new Date().toISOString()
            });

            question.block.style.outline = `3px solid ${CONFIG.SELECTED_COLOR}`;
            updateStatus(`✅ Question ${index + 1} solved!`, 'success');
            
            if (CONFIG.SHOW_REASONING) {
                console.log(`📝 Reasoning for Q${index + 1}:`, aiResponse);
            }

            if (CONFIG.AUTO_SELECT) {
                await selectSingleAnswer(index);
            }

            renderQuestionsList();

        } catch (error) {
            updateStatus(`❌ Error: ${error.message}`, 'error');
            question.block.style.outline = '3px solid #f44336';
            console.error('Full error:', error);
        }
    }

    // Solve all questions
    async function solveAllQuestions() {
        updateStatus(`🔄 Solving ${questions.length} questions...`, 'info');
        
        for (let i = 0; i < questions.length; i++) {
            await solveQuestion(i);
            await new Promise(r => setTimeout(r, 1500));
        }
        
        updateStatus(`✅ All questions solved!`, 'success');
    }

    // Select single answer
    async function selectSingleAnswer(index) {
        const question = questions[index];
        const solution = solutions.find(s => s.index === index);
        
        if (!question || !solution) {
            updateStatus(`❌ No solution for question ${index + 1}`, 'error');
            return;
        }

        if (question.type === "choice") {
            const answerLetter = solution.solution.toUpperCase();
            const answerIndex = answerLetter.charCodeAt(0) - 65;
            
            if (answerIndex >= 0 && answerIndex < question.options.length) {
                question.options[answerIndex].element.click();
                question.options[answerIndex].element.style.outline = `3px solid ${CONFIG.SELECTED_COLOR}`;
                question.options[answerIndex].element.style.backgroundColor = '#e8f5e8';
                updateStatus(`✅ Selected option ${answerLetter} for Q${index + 1}`, 'success');
            }
        }
        else if (question.type === "biology-table") {
            // For biology table questions, try to select the matching option
            const solutionText = solution.solution;
            if (question.options.length > 0) {
                // Find option that matches the solution
                const matchingOption = question.options.find(opt => 
                    opt.text === solutionText || opt.text.includes(solutionText)
                );
                
                if (matchingOption) {
                    matchingOption.element.click();
                    matchingOption.element.style.outline = `3px solid ${CONFIG.SELECTED_COLOR}`;
                    matchingOption.element.style.backgroundColor = '#e8f5e8';
                    updateStatus(`✅ Selected ${matchingOption.text} for Q${index + 1}`, 'success');
                } else {
                    console.log('Available options:', question.options.map(o => o.text));
                    console.log('Solution was:', solutionText);
                    updateStatus(`⚠️ Could not find matching option for Q${index + 1}`, 'warning');
                }
            }
        }
        else if (question.type === "dropdown") {
            const answers = solution.solution.split(',').map(a => a.trim());
            
            for (let j = 0; j < Math.min(answers.length, question.dropdowns.length); j++) {
                const answer = answers[j];
                const dropdown = question.dropdowns[j].element;
                
                dropdown.click();
                await new Promise(r => setTimeout(r, 500));
                
                let optionSelected = false;
                
                const allElements = document.querySelectorAll('div, span, li, [role="option"]');
                for (const el of allElements) {
                    if (el.offsetParent !== null) {
                        const text = cleanText(el.innerText);
                        if (text === answer || text.includes(answer) || answer.includes(text)) {
                            el.click();
                            optionSelected = true;
                            console.log(`✅ Selected "${answer}" for blank ${j + 1}`);
                            break;
                        }
                    }
                }
                
                if (!optionSelected) {
                    try {
                        const xpathResult = document.evaluate(
                            `//*[contains(text(), '${answer}')]`,
                            document,
                            null,
                            XPathResult.FIRST_ORDERED_NODE_TYPE,
                            null
                        );
                        if (xpathResult.singleNodeValue) {
                            xpathResult.singleNodeValue.click();
                            optionSelected = true;
                        }
                    } catch (e) {}
                }
                
                if (!optionSelected) {
                    console.log(`❌ Could not select "${answer}" for blank ${j + 1}`);
                    document.dispatchEvent(new KeyboardEvent('keydown', {'key': 'Escape'}));
                }
                
                await new Promise(r => setTimeout(r, 300));
            }
        }
        else if (question.type === "matching") {
            console.log(`📝 Matching question ${index + 1}:`, solution.solution);
            updateStatus(`✅ Matching solution shown for Q${index + 1}`, 'success');
        }
    }

    // Select all answers
    async function selectAnswers() {
        updateStatus(`🎯 Selecting answers...`, 'info');
        
        for (let i = 0; i < questions.length; i++) {
            await selectSingleAnswer(i);
        }
        
        updateStatus(`✅ Answer selection complete!`, 'success');
    }

    // Export data
    function exportData() {
        const data = {
            timestamp: new Date().toISOString(),
            questions: questions.map(q => ({
                index: q.index,
                text: q.text,
                type: q.type,
                options: q.options.map(o => o.text),
                blanks: q.dropdowns.length,
                matchingPairs: q.matchingPairs.map(p => ({
                    text: p.text,
                    isFormula: p.isFormula
                })),
                tableData: q.tableData
            })),
            solutions: solutions
        };
        
        copyToClipboard(JSON.stringify(data, null, 2));
        updateStatus('📋 Data copied to clipboard!', 'success');
    }

    // Clear all
    function clearAll() {
        questions = [];
        solutions = [];
        document.querySelectorAll('[style*="outline"]').forEach(el => {
            el.style.outline = '';
            el.style.backgroundColor = '';
        });
        renderQuestionsList();
        updateStatus('🧹 All cleared', 'info');
    }

    // Copy to clipboard
    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    // Initialize
    console.log(`
╔════════════════════════════════════╗
║  EMAKTAB TEST SOLVER LOADED!       ║
║  Look for the blue panel on the     ║
║  right side of the page.            ║
║  Press Ctrl+Shift+E to extract      ║
╚════════════════════════════════════╝
    `);

    createUIPanel();
})();
