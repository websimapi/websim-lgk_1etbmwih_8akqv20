import { pipeline, env } from '@xenova/transformers';

// Disable local model loading, use remote models
env.allowRemoteModels = true;
env.allowLocalModels = false;

class AudioCaptioner {
    constructor() {
        this.audioPlayer = document.getElementById('audioPlayer');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.captionBtn = document.getElementById('captionBtn');
        this.captionsDisplay = document.getElementById('captionsDisplay');
        this.captionsHistory = document.getElementById('captionsHistory');
        this.playerSection = document.getElementById('playerSection');
        this.audioFile = document.getElementById('audioFile');
        this.downloadBtn = document.getElementById('downloadBtn');
        
        // Voice cloning elements
        this.voiceFile = document.getElementById('voiceFile');
        this.voiceStatus = document.getElementById('voiceStatus');
        this.textInput = document.getElementById('textInput');
        this.generateSpeechBtn = document.getElementById('generateSpeechBtn');
        this.useCaptionedVoiceBtn = document.getElementById('useCaptionedVoiceBtn');
        
        this.transcriber = null;
        this.isProcessing = false;
        this.captions = [];
        this.currentAudioFile = null;
        this.voiceSample = null; // Can be File, data URL (from fileToDataURL/blobUrlToDataURL), or public HTTP/HTTPS URL
        this.isGeneratingSpeech = false;
        
        this.initializeEventListeners();
        this.initializeTranscriber();
    }
    
    initializeEventListeners() {
        this.audioFile.addEventListener('change', (e) => this.handleFileUpload(e));
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.captionBtn.addEventListener('click', () => this.generateCaptions());
        this.downloadBtn.addEventListener('click', () => this.downloadCaptions());
        
        // Voice cloning event listeners
        this.voiceFile.addEventListener('change', (e) => this.handleVoiceUpload(e));
        this.generateSpeechBtn.addEventListener('click', () => this.generateSpeech());
        this.useCaptionedVoiceBtn.addEventListener('click', () => this.useCaptionedVoice());
        this.textInput.addEventListener('input', () => this.updateGenerateButton());
        
        this.audioPlayer.addEventListener('play', () => this.updatePlayButton(false));
        this.audioPlayer.addEventListener('pause', () => this.updatePlayButton(true));
        this.audioPlayer.addEventListener('ended', () => this.updatePlayButton(true));
        this.audioPlayer.addEventListener('timeupdate', () => this.updateCurrentCaption());
    }
    
    async fileToDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    }

    async blobUrlToDataURL(blobUrl) {
        try {
            const response = await fetch(blobUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch blob from URL: ${response.statusText}`);
            }
            const blob = await response.blob();
            return this.fileToDataURL(blob); // Re-use fileToDataURL for blob
        } catch (error) {
            console.error('Error converting blob URL to Data URL:', error);
            // Do not automatically show error to user here, let caller handle
            throw error;
        }
    }
    
    async initializeTranscriber() {
        try {
            // Initialize the transcription pipeline
            this.transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');
        } catch (error) {
            console.error('Failed to initialize transcriber:', error);
        }
    }
    
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        this.currentAudioFile = file;
        const url = URL.createObjectURL(file);
        this.audioPlayer.src = url;
        this.playerSection.classList.add('active');
        
        // Clear previous captions
        this.captions = [];
        this.updateCaptionsDisplay('Upload complete! Click "Generate Captions" to transcribe the audio.');
        this.updateCaptionsHistory();
        
        // Reset caption button and hide download button
        this.captionBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path>
            </svg>
            Generate Captions
        `;
        this.captionBtn.classList.remove('active', 'processing');
        this.downloadBtn.style.display = 'none';
        
        // Show "Use Captioned Voice" button if captions were generated
        if (this.captions.length > 0) {
            this.useCaptionedVoiceBtn.style.display = 'flex';
        }
    }
    
    handleVoiceUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        this.voiceSample = file;
        this.voiceStatus.textContent = `Voice sample uploaded: ${file.name}`;
        this.voiceStatus.classList.add('success');
        this.updateGenerateButton();
    }
    
    updateGenerateButton() {
        const hasVoice = this.voiceSample !== null;
        const hasText = this.textInput.value.trim().length > 0;
        this.generateSpeechBtn.disabled = !hasVoice || !hasText || this.isGeneratingSpeech;
    }
    
    async fetchWithProxies(url, options = {}) {
        this.updateCaptionsDisplay(`Fetching: ${url.substring(0, 60)}...`);
        try {
            // Try direct fetch first
            const response = await fetch(url, options);
            if (response.ok) {
                this.updateCaptionsDisplay(`Successfully fetched: ${url.substring(0, 60)}`);
                return response;
            }
            // Log non-OK responses but still try proxies, as it might be a CORS issue not trapped by catch
            console.warn(`Direct fetch for ${url} returned status: ${response.status}. Body: ${await response.text().catch(() => '[could not read body]')}. Attempting proxies.`);
        } catch (error) { // Catches network errors, failed DNS, etc.
            console.warn(`Direct fetch for ${url} failed: ${error.message}. Attempting proxies.`);
        }
    
        this.updateCaptionsDisplay(`Direct fetch failed for ${url.substring(0, 60)}. Trying CORS proxies...`);
        // Proxies similar to those in generateSpeech
        const proxies = [
            { prefix: 'https://api.allorigins.win/raw?url=', encodeTargetURL: true, name: 'All Origins' },
            { prefix: 'https://thingproxy.freeboard.io/fetch/', encodeTargetURL: false, name: 'Thingproxy' },
            { prefix: 'https://corsproxy.io/?', encodeTargetURL: true, name: 'CORSProxy.io' },
            { prefix: 'https://proxy.cors.sh/', encodeTargetURL: false, name: 'proxy.cors.sh' }
        ];
    
        for (const proxy of proxies) {
            const targetUrlForProxy = proxy.encodeTargetURL ? encodeURIComponent(url) : url;
            const proxiedUrl = proxy.prefix + targetUrlForProxy;
            this.updateCaptionsDisplay(`Trying proxy: ${proxy.name}...`);
            console.log(`Attempting to fetch audio data via proxy: ${proxy.name} - ${proxiedUrl}`);
            try {
                const response = await fetch(proxiedUrl, options);
                if (response.ok) {
                    this.updateCaptionsDisplay(`Successfully fetched audio via ${proxy.name}!`);
                    console.log(`Successfully fetched audio data using proxy: ${proxy.name}`);
                    return response;
                }
                console.warn(`Proxy ${proxy.name} failed for ${url} with status: ${response.status}. Body: ${await response.text().catch(() => '[could not read body]')}`);
            } catch (proxyError) {
                console.warn(`Proxy ${proxy.name} failed for ${url}: ${proxyError.message}`);
            }
        }
        this.updateCaptionsDisplay(`Error: Failed to fetch audio from ${url.substring(0, 60)} after trying all proxies.`);
        throw new Error(`Failed to fetch ${url} directly and with all available proxies.`);
    }
    
    async generateSpeech() {
        if (this.isGeneratingSpeech || !this.textInput.value.trim()) return;
        
        this.isGeneratingSpeech = true;
        this.generateSpeechBtn.classList.add('generating');
        this.generateSpeechBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
            Generating...
        `;
        this.generateSpeechBtn.disabled = true;
        
        try {
            const text = this.textInput.value.trim();
            let voiceSampleInputForApi;
            let isPublicHttpUrl = false;

            this.updateCaptionsDisplay('Preparing voice sample...');
            if (this.voiceSample instanceof File) {
                voiceSampleInputForApi = await this.fileToDataURL(this.voiceSample);
            } else if (typeof this.voiceSample === 'string') {
                if (this.voiceSample.startsWith('blob:')) {
                    voiceSampleInputForApi = await this.blobUrlToDataURL(this.voiceSample);
                } else if (this.voiceSample.startsWith('data:')) {
                    voiceSampleInputForApi = this.voiceSample;
                } else if (this.voiceSample.startsWith('http:') || this.voiceSample.startsWith('https:')) {
                    voiceSampleInputForApi = this.voiceSample;
                    isPublicHttpUrl = true;
                } else {
                     throw new Error('Voice sample is not a File, Blob URL, Data URL, or public HTTP/HTTPS URL.');
                }
            } else {
                throw new Error('Voice sample is in an unexpected format.');
            }

            if (!voiceSampleInputForApi) {
                 throw new Error('Failed to prepare voice sample for the API.');
            }
            
            this.updateCaptionsDisplay('Generating speech with AI... This may take a moment.');
            
            let ttsResult;
            try {
                ttsResult = await websim.textToSpeech({
                    text: text,
                    voice_sample: voiceSampleInputForApi
                });
            } catch (error) {
                // Only attempt proxies if the original voiceSampleInputForApi was a public HTTP URL
                // and the error might be CORS-related (which websim.textToSpeech might obscure).
                if (isPublicHttpUrl) { 
                    console.warn(`Direct use of public URL ${voiceSampleInputForApi} for voice sample failed. Attempting CORS proxies. Original error:`, error);
                    this.updateCaptionsDisplay('Voice sample URL failed directly, trying CORS proxies for voice sample...');
                    
                    const proxies = [ // Ensure this list is maintained if proxies change
                        { prefix: 'https://api.allorigins.win/raw?url=', encodeTargetURL: true, name: 'All Origins' },
                        { prefix: 'https://thingproxy.freeboard.io/fetch/', encodeTargetURL: false, name: 'Thingproxy' },
                        { prefix: 'https://corsproxy.io/?', encodeTargetURL: true, name: 'CORSProxy.io' },
                        { prefix: 'https://proxy.cors.sh/', encodeTargetURL: false, name: 'proxy.cors.sh' }
                    ];

                    let proxiedSuccess = false;
                    for (const proxy of proxies) {
                        const targetUrlForProxy = proxy.encodeTargetURL ? encodeURIComponent(voiceSampleInputForApi) : voiceSampleInputForApi;
                        const proxiedUrl = proxy.prefix + targetUrlForProxy;
                        
                        this.updateCaptionsDisplay(`Trying voice sample via proxy: ${proxy.name}...`);
                        try {
                            ttsResult = await websim.textToSpeech({
                                text: text,
                                voice_sample: proxiedUrl
                            });
                            console.log(`Successfully generated speech using voice sample proxy: ${proxy.name} (${proxy.prefix})`);
                            this.updateCaptionsDisplay(`Speech generated successfully using voice sample via proxy: ${proxy.name}!`);
                            proxiedSuccess = true;
                            break; 
                        } catch (proxyError) {
                            console.warn(`Voice sample proxy ${proxy.name} (${proxy.prefix}) failed for URL ${voiceSampleInputForApi}:`, proxyError);
                        }
                    }
                    if (!proxiedSuccess) {
                        console.error("All proxies failed for voice sample.", error);
                        throw new Error('Failed to generate speech using voice sample, even with proxies. Original error: ' + (error.message || error));
                    }
                } else {
                    // If it wasn't a public HTTP URL, or if proxies also failed, re-throw the original error.
                    console.error("Speech generation failed, not a public URL or proxies exhausted.", error);
                    throw error; 
                }
            }
            
            this.audioPlayer.src = ttsResult.url; // This URL might be what needs proxying later for transcription
            this.playerSection.classList.add('active');
            
            this.currentAudioFile = {
                name: 'generated_speech.wav', 
                type: 'audio/wav' 
            };
            
            this.captions = [];
            this.updateCaptionsDisplay('Speech generated successfully! Click "Generate Captions" to transcribe this audio.');
            this.updateCaptionsHistory();
            
            this.captionBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"></path>
                </svg>
                Generate Captions
            `;
            this.captionBtn.classList.remove('active', 'processing');
            this.downloadBtn.style.display = 'none';
            this.useCaptionedVoiceBtn.style.display = 'flex'; 
        } catch (error) {
            console.error('Speech generation process error:', error);
            let displayErrorMessage = 'Failed to generate speech. ';
            if (error && error.message) {
                displayErrorMessage += (error.message.toLowerCase().startsWith('error:') ? error.message.substring(6).trim() : error.message);
            } else {
                displayErrorMessage += 'An unknown error occurred. Please try again or use a different voice sample.';
            }
            this.showError(displayErrorMessage);
        } finally {
            this.isGeneratingSpeech = false;
            this.generateSpeechBtn.classList.remove('generating');
            this.generateSpeechBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
                Generate Speech
            `;
            this.updateGenerateButton();
        }
    }
    
    useCaptionedVoice() {
        if (!this.currentAudioFile) return;
        
        this.voiceSample = this.audioPlayer.src;
        this.voiceStatus.textContent = `Voice sample set from captioned audio: ${this.currentAudioFile.name || 'generated audio'}`;
        this.voiceStatus.classList.add('success');
        this.updateGenerateButton();
    }
    
    async generateCaptions() {
        if (this.isProcessing || !this.currentAudioFile) return;
        
        if (!this.transcriber) {
            this.showError('Transcriber is still loading. Please wait a moment and try again.');
            return;
        }
        
        // Clear any previous words / placeholders before showing progress.
        this.captionsDisplay.innerHTML = ''; 
        
        this.isProcessing = true;
        this.captionBtn.classList.add('processing');
        this.captionBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
            Processing...
        `;
        
        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBar.innerHTML = '<div class="progress-fill"></div>';
        this.captionsDisplay.appendChild(progressBar);
        
        try {
            this.updateCaptionsDisplay('Preparing audio data...');
            
            let audioBuffer;
            // Check if currentAudioFile indicates it's from TTS
            if (this.currentAudioFile && this.currentAudioFile.name === 'generated_speech.wav') {
                console.log("Generating captions for TTS audio, source URL:", this.audioPlayer.src);
                audioBuffer = await this.convertAudioFromUrl(this.audioPlayer.src);
            } else if (this.currentAudioFile) { // For uploaded files
                console.log("Generating captions for uploaded file:", this.currentAudioFile.name);
                audioBuffer = await this.convertAudioFile(this.currentAudioFile);
            } else {
                this.showError("No audio file available for captioning.");
                this.captionBtn.classList.remove('processing');
                this.isProcessing = false;
                return;
            }
            
            this.updateCaptionsDisplay('Transcribing audio with AI... This may take a moment.');
            
            const result = await this.transcriber(audioBuffer, {
                return_timestamps: "word",
                chunk_length_s: 30,
                stride_length_s: 5,
            });
            
            this.captions = this.processTranscriptionResult(result);
            
            this.captionBtn.classList.remove('processing');
            this.captionBtn.classList.add('active');
            this.captionBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 6L9 17l-5-5"></path>
                </svg>
                Captions Ready
            `;
            
            this.updateCaptionsDisplay('Captions generated successfully! Play the audio to see synchronized captions.');
            this.updateCaptionsHistory();
            
            this.downloadBtn.style.display = 'flex';
            this.useCaptionedVoiceBtn.style.display = 'flex';
        } catch (error) {
            console.error('Transcription error:', error);
            this.showError('Failed to transcribe audio: ' + error.message);
            this.captionBtn.classList.remove('processing');
        } finally {
            this.isProcessing = false;
            const progressBar = this.captionsDisplay.querySelector('.progress-bar');
            if (progressBar) progressBar.remove();
        }
    }
    
    async convertAudioFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const arrayBuffer = e.target.result;
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    
                    const sampleRate = 16000;
                    const length = Math.floor(audioBuffer.duration * sampleRate);
                    const result = new Float32Array(length);
                    
                    const inputData = audioBuffer.getChannelData(0);
                    const ratio = inputData.length / length;
                    
                    for (let i = 0; i < length; i++) {
                        const index = Math.floor(i * ratio);
                        result[i] = inputData[index];
                    }
                    
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
    
    async convertAudioFromUrl(url) {
        console.log("convertAudioFromUrl attempting to fetch and process URL:", url);
        return new Promise(async (resolve, reject) => {
            try {
                // Use the new fetchWithProxies helper
                const response = await this.fetchWithProxies(url); 
                const arrayBuffer = await response.arrayBuffer();
                
                // Rest of the audio processing logic is the same
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const audioBufferDecoded = await audioContext.decodeAudioData(arrayBuffer);
                
                const targetSampleRate = 16000; // Whisper expects 16kHz
                if (audioBufferDecoded.sampleRate === targetSampleRate && audioBufferDecoded.numberOfChannels === 1) {
                     resolve(audioBufferDecoded.getChannelData(0));
                     return;
                }

                // Resample and convert to mono if necessary
                const offlineContext = new OfflineAudioContext(
                    audioBufferDecoded.numberOfChannels,
                    audioBufferDecoded.duration * targetSampleRate,
                    targetSampleRate
                );
                const bufferSource = offlineContext.createBufferSource();
                bufferSource.buffer = audioBufferDecoded;
                bufferSource.connect(offlineContext.destination);
                bufferSource.start();
                
                const resampledBuffer = await offlineContext.startRendering();
                resolve(resampledBuffer.getChannelData(0)); // Assuming mono after processing

            } catch (error) {
                console.error('Full error in convertAudioFromUrl:', error);
                this.showError('Failed to process audio from URL: ' + error.message);
                reject(error);
            }
        });
    }
    
    processTranscriptionResult(result) {
        if (!result.chunks) return [];
        
        const words = [];
        result.chunks.forEach(chunk => {
            if (chunk.timestamp && chunk.timestamp.length >= 2) {
                words.push({
                    text: chunk.text.trim(),
                    start: chunk.timestamp[0],
                    end: chunk.timestamp[1]
                });
            }
        });
        
        return words.filter(word => word.text.length > 0);
    }
    
    updateCurrentCaption() {
        if (this.captions.length === 0 || this.isProcessing) return; // also check isProcessing
        
        const currentTime = this.audioPlayer.currentTime;
        
        let lastWordIndex = -1;
        for (let i = 0; i < this.captions.length; i++) {
            if (currentTime >= this.captions[i].start) {
                lastWordIndex = i;
            } else {
                break;
            }
        }
        
        if (lastWordIndex >= 0) {
            const currentWordCount = this.captionsDisplay.querySelectorAll('.caption-word').length;
            const shouldShowWords = lastWordIndex + 1;
            
            if (shouldShowWords > currentWordCount) {
                for (let i = currentWordCount; i < shouldShowWords; i++) {
                    this.addWordToDisplay(this.captions[i].text);
                }
            }
        }
    }
    
    addWordToDisplay(word) {
        let currentCaptionDiv = this.captionsDisplay.querySelector('.current-caption');
        
        if (!currentCaptionDiv) {
            currentCaptionDiv = document.createElement('div');
            currentCaptionDiv.className = 'current-caption';
            this.captionsDisplay.innerHTML = '';
            this.captionsDisplay.appendChild(currentCaptionDiv);
        }
        
        const wordSpan = document.createElement('span');
        wordSpan.className = 'caption-word';
        wordSpan.textContent = word;
        currentCaptionDiv.appendChild(wordSpan);
    }
    
    updateCaptionsDisplay(text) {
        const progressBar = this.captionsDisplay.querySelector('.progress-bar');
        const isStatusUpdate = text.includes('Error:') || text.includes('successfully') || 
                             text.includes('Converting') || text.includes('Transcribing') || 
                             text.includes('Upload complete') || text.includes('Preparing') || 
                             text.includes('Using') || text.includes('Trying proxy') || 
                             text.includes('Generating speech') || text.includes('Fetching');

        if (progressBar && !isStatusUpdate) { // If progress bar exists, and this is not a status update, do nothing
            return;
        }

        if (isStatusUpdate) {
            // For status updates, always show them. Clear existing words if any.
            const currentCaptionContainer = this.captionsDisplay.querySelector('.current-caption');
            if (currentCaptionContainer) {
                currentCaptionContainer.remove();
            }
            if (text.toLowerCase().includes('error:')) {
                this.captionsDisplay.innerHTML = `<p class="placeholder-text error-message">${text}</p>`;
            } else {
                this.captionsDisplay.innerHTML = `<p class="placeholder-text">${text}</p>`;
            }
        } else { // Not a status update
            if (this.captions.length === 0 && !this.isProcessing) {
                // Only set placeholder if no captions AND not currently processing
                this.captionsDisplay.innerHTML = `<p class="placeholder-text">${text || 'Captions will appear here when you start the captioning...'}</p>`;
            }
            // If captions.length > 0 or isProcessing, display is managed by word-by-word rendering or progress bar, so do nothing here.
        }
    }
    
    updateCaptionsHistory() {
        const sentences = [];
        let currentSentence = [];
        let sentenceStart = 0;
        
        this.captions.forEach((word, index) => {
            if (currentSentence.length === 0) {
                sentenceStart = word.start;
            }
            currentSentence.push(word.text);
            
            if (word.text.match(/[.!?]$/) || currentSentence.length >= 15 || index === this.captions.length - 1) {
                sentences.push({
                    text: currentSentence.join(' '),
                    start: sentenceStart,
                    end: word.end
                });
                currentSentence = [];
            }
        });
        
        this.captionsHistory.innerHTML = sentences
            .slice(-10) 
            .map(sentence => `
                <div class="caption-item">
                    <strong>${this.formatTime(sentence.start)} - ${this.formatTime(sentence.end)}:</strong> ${sentence.text}
                </div>
            `).join('');
        
        this.captionsHistory.scrollTop = this.captionsHistory.scrollHeight;
    }
    
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    generateSRTContent() {
        let srtContent = '';
        let entryIndex = 1;
        let currentSrtLineWords = [];
        let currentSrtLineStartTime = 0;

        if (this.captions.length === 0) {
            return srtContent; // Return empty string if no captions
        }

        this.captions.forEach((word, captionIdx) => {
            if (currentSrtLineWords.length === 0) {
                currentSrtLineStartTime = word.start;
            }
            currentSrtLineWords.push(word.text);

            const isPunctuationEnd = /[.!?]$/.test(word.text);
            const isLineTooLong = currentSrtLineWords.length >= 10; // Max words per line
            const isLastWordOfAllCaptions = captionIdx === this.captions.length - 1;
            // Consider time limits for SRT lines too, e.g., 5-7 seconds, but word count is simpler here

            if (isPunctuationEnd || isLineTooLong || isLastWordOfAllCaptions) {
                if (currentSrtLineWords.length > 0) {
                    const lineText = currentSrtLineWords.join(' ');
                    const lineEndTime = word.end;

                    srtContent += `${entryIndex}\n`;
                    srtContent += `${this.formatSRTTime(currentSrtLineStartTime)} --> ${this.formatSRTTime(lineEndTime)}\n`;
                    srtContent += `${lineText}\n\n`;

                    currentSrtLineWords = [];
                    entryIndex++;
                }
            }
        });
        
        return srtContent.trim(); // Trim trailing newlines
    }
    
    formatSRTTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
    }
    
    togglePlayPause() {
        if (this.audioPlayer.paused) {
            this.audioPlayer.play();
        } else {
            this.audioPlayer.pause();
        }
    }
    
    updatePlayButton(isPaused) {
        const icon = this.playPauseBtn.querySelector('svg');
        if (isPaused) {
            icon.innerHTML = '<polygon points="5,3 19,12 5,21"></polygon>';
        } else {
            icon.innerHTML = '<rect x="4" y="3" width="4" height="18"></rect><rect x="12" y="3" width="4" height="18"></rect>';
        }
    }
    
    downloadCaptions() {
        if (this.captions.length === 0) return;
        
        const srtContent = this.generateSRTContent();
        
        const blob = new Blob([srtContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentAudioFile.name.split('.')[0]}_captions.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    showError(message) {
        this.captionsDisplay.innerHTML = `<p class="placeholder-text error-message">Error: ${message}</p>`;
        console.error("Error displayed to user:", message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AudioCaptioner();
});