// live2d-chat-extension.js
// Live2D Widget 聊天扩展

(function() {
    'use strict';

    // 聊天扩展类
    class L2DChatExtension {
        constructor(options = {}) {
            // 默认配置
            this.config = {
                apiEndpoint: options.apiEndpoint || '/api/chat',
                configEndpoint: options.configEndpoint || '/api/config',
                position: options.position || 'right', // 聊天框位置：left, right
                theme: options.theme || 'default', // 主题：default, dark, cute
                showOnHover: options.showOnHover !== false, // 悬停显示
                hoverArea: options.hoverArea || null, // 自定义悬停区域
                messages: options.messages || {
                    placeholder: '输入消息...',
                    title: '与我聊天',
                    error: '哎呀，我暂时还不想回答这个问题，等一会儿再来问我吧。',
                    thinking: '思考中...'
                },
                ...options
            };

            this.messages = [];
            this.isStreaming = false;
            this.chatVisible = false;
            this.turnstileToken = null;
            this.turnstileWidgetId = null;
            this.inputFocused = false; // 添加输入框焦点状态
            this.pendingMessage = null; // 添加待发送消息

            // 初始化
            this.init();
        }

        // 初始化
        async init() {
            // 加载配置
            await this.loadConfig();
            
            // 创建聊天界面
            this.createChatUI();
            
            // 创建悬停区域（如果需要）
            this.createHoverArea();
            
            // 绑定事件
            this.bindEvents();
            
            // 添加样式
            this.injectStyles();
        }

        // 创建悬停区域
        createHoverArea() {
            // 如果没有指定自定义悬停区域，创建一个默认的
            if (!this.config.hoverArea && this.config.showOnHover) {
                const hoverArea = document.createElement('div');
                hoverArea.id = 'l2d-hover-area';
                hoverArea.className = 'l2d-hover-area';
                
                // 获取 Live2D 容器的位置和尺寸
                const live2dContainer = document.getElementById('live2d-widget');
                if (live2dContainer) {
                    const rect = live2dContainer.getBoundingClientRect();
                    hoverArea.style.cssText = `
                        position: fixed;
                        width: ${rect.width}px;
                        height: ${rect.height}px;
                        right: ${window.innerWidth - rect.right}px;
                        bottom: ${window.innerHeight - rect.bottom}px;
                        z-index: 99998;
                        cursor: pointer;
                    `;
                    document.body.appendChild(hoverArea);
                    this.config.hoverArea = hoverArea;
                }
            }
        }

        // 加载服务器配置
        async loadConfig() {
            try {
                const response = await fetch(this.config.configEndpoint);
                if (response.ok) {
                    const serverConfig = await response.json();
                    Object.assign(this.config, serverConfig);
                    
                    // 如果需要 Turnstile，加载脚本
                    if (this.config.requireTurnstile && this.config.turnstileSiteKey) {
                        await this.loadTurnstile();
                    }
                }
            } catch (error) {
                console.warn('Failed to load chat config:', error);
            }
        }

        // 加载 Turnstile 脚本
        async loadTurnstile() {
            return new Promise((resolve) => {
                if (window.turnstile) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                script.async = true;
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }

        // 创建聊天UI
        createChatUI() {
            // 创建聊天容器
            const chatHTML = `
                <div id="l2d-chat-container" class="l2d-chat-container ${this.config.position} ${this.config.theme}">
                    <div class="l2d-chat-header">
                        <span class="l2d-chat-title">${this.config.messages.title}</span>
                        <button class="l2d-chat-close">&times;</button>
                    </div>
                    <div class="l2d-chat-messages" id="l2d-chat-messages"></div>
                    <div class="l2d-chat-input-container">
                        <div id="l2d-turnstile-container" class="l2d-turnstile-container"></div>
                        <div class="l2d-chat-input-row" id="l2d-chat-input-row" style="display: none;">
                            <input type="text" 
                                   class="l2d-chat-input" 
                                   id="l2d-chat-input" 
                                   placeholder="${this.config.messages.placeholder}"
                                   autocomplete="off">
                            <button class="l2d-chat-send" id="l2d-chat-send">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                    <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // 插入到页面
            const chatDiv = document.createElement('div');
            chatDiv.innerHTML = chatHTML;
            document.body.appendChild(chatDiv.firstElementChild);

            // 保存元素引用
            this.elements = {
                container: document.getElementById('l2d-chat-container'),
                messages: document.getElementById('l2d-chat-messages'),
                input: document.getElementById('l2d-chat-input'),
                sendBtn: document.getElementById('l2d-chat-send'),
                closeBtn: document.querySelector('.l2d-chat-close'),
                turnstileContainer: document.getElementById('l2d-turnstile-container'),
                inputRow: document.getElementById('l2d-chat-input-row')
            };
        }

        // 绑定事件
        bindEvents() {
            // 悬停事件处理
            if (this.config.showOnHover) {
                const hoverTarget = this.config.hoverArea || document.getElementById('l2d-hover-area');
                
                if (hoverTarget) {
                    // 鼠标进入显示聊天框
                    hoverTarget.addEventListener('mouseenter', () => {
                        this.show();
                    });
                    
                    // 鼠标离开时的处理
                    let hideTimeout;
                    const startHideTimeout = () => {
                        hideTimeout = setTimeout(() => {
                            // 检查是否正在输入或聊天框有焦点
                            if (!this.isMouseOverChat() && !this.hasFocus()) {
                                this.hide();
                            }
                        }, 500);
                    };

                    hoverTarget.addEventListener('mouseleave', startHideTimeout);
                    
                    // 聊天框的鼠标事件
                    this.elements.container.addEventListener('mouseenter', () => {
                        clearTimeout(hideTimeout);
                    });
                    
                    this.elements.container.addEventListener('mouseleave', () => {
                        if (!this.isMouseOverHoverArea() && !this.hasFocus()) {
                            this.hide();
                        }
                    });
                }
            }

            // 点击事件（作为备选方案）
            const live2dCanvas = document.getElementById('live2dcanvas');
            if (live2dCanvas) {
                // 临时启用 pointer-events 来处理点击
                live2dCanvas.style.pointerEvents = 'auto';
                live2dCanvas.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggle();
                });
            }

            // 关闭按钮
            this.elements.closeBtn.addEventListener('click', () => this.hide());

            // 发送消息
            this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
            this.elements.input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            // 输入框焦点事件 - 防止在输入时隐藏
            this.elements.input.addEventListener('focus', () => {
                this.inputFocused = true;
            });

            this.elements.input.addEventListener('blur', () => {
                this.inputFocused = false;
            });

            // 监听输入事件，防止在输入时隐藏
            this.elements.input.addEventListener('input', (e) => {
                e.stopPropagation();
                this.inputFocused = true;
            });

            // 监听所有键盘事件，防止在输入时隐藏
            this.elements.input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                this.inputFocused = true;
            });

            this.elements.input.addEventListener('keyup', (e) => {
                e.stopPropagation();
                this.inputFocused = true;
            });

            // 防止聊天框内的点击事件冒泡
            this.elements.container.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // 防止聊天框内的所有键盘事件冒泡
            this.elements.container.addEventListener('keydown', (e) => {
                e.stopPropagation();
            });

            this.elements.container.addEventListener('keyup', (e) => {
                e.stopPropagation();
            });

            this.elements.container.addEventListener('keypress', (e) => {
                e.stopPropagation();
            });

            // 添加触摸事件支持（移动端）
            if ('ontouchstart' in window) {
                const live2dWidget = document.getElementById('live2d-widget');
                if (live2dWidget) {
                    live2dWidget.addEventListener('touchstart', () => {
                        this.toggle();
                    });
                }
            }
        }

        // 检查是否有焦点
        hasFocus() {
            return this.inputFocused || 
                   this.elements.container.contains(document.activeElement) ||
                   document.activeElement === this.elements.input;
        }

        // 检查鼠标是否在聊天框上
        isMouseOverChat() {
            return this.elements.container.matches(':hover');
        }

        // 检查鼠标是否在悬停区域上
        isMouseOverHoverArea() {
            const hoverArea = this.config.hoverArea || document.getElementById('l2d-hover-area');
            return hoverArea && hoverArea.matches(':hover');
        }

        // 显示聊天框
        show() {
            this.elements.container.classList.add('show');
            this.chatVisible = true;
            
            // 初始化 Turnstile（如果需要且尚未初始化）
            if (this.config.requireTurnstile && this.config.turnstileSiteKey) {
                if (!this.turnstileWidgetId && !this.turnstileToken) {
                    this.showTurnstile();
                } else if (this.turnstileToken) {
                    // 如果已经有 token，显示输入框
                    this.elements.inputRow.style.display = 'flex';
                }
            } else {
                // 如果不需要验证码，直接显示输入框
                this.elements.inputRow.style.display = 'flex';
            }
        }

        // 初始化 Turnstile
        initTurnstile() {
            if (!window.turnstile || !this.elements.turnstileContainer) return;

            // 清空容器以防重复渲染
            this.elements.turnstileContainer.innerHTML = '';
            
            this.turnstileWidgetId = window.turnstile.render(this.elements.turnstileContainer, {
                sitekey: this.config.turnstileSiteKey,
                callback: (token) => {
                    console.log('Turnstile verification successful');
                    this.turnstileToken = token;
                    // 验证成功后隐藏验证码，显示输入框
                    this.elements.turnstileContainer.style.display = 'none';
                    this.elements.inputRow.style.display = 'flex';
                    // 添加动画类
                    this.elements.inputRow.classList.add('show-animation');
                    // 确保输入框可见后再聚焦
                    setTimeout(() => {
                        // 如果有待发送的消息，恢复到输入框
                        if (this.pendingMessage) {
                            this.elements.input.value = this.pendingMessage;
                            // 自动发送
                            this.sendMessage();
                        } else {
                            this.elements.input.focus();
                        }
                        // 移除动画类
                        this.elements.inputRow.classList.remove('show-animation');
                    }, 350);
                },
                'expired-callback': () => {
                    console.log('Turnstile token expired');
                    this.turnstileToken = null;
                    // 验证过期，重新显示验证码
                    this.elements.turnstileContainer.style.display = 'flex';
                    this.elements.inputRow.style.display = 'none';
                    if (window.turnstile && this.turnstileWidgetId !== null) {
                        window.turnstile.reset(this.turnstileWidgetId);
                    }
                },
                'error-callback': () => {
                    console.error('Turnstile error');
                    // 错误时也显示输入框，让用户可以继续使用
                    this.elements.inputRow.style.display = 'flex';
                },
                size: 'normal',
                theme: this.config.theme === 'dark' ? 'dark' : 'light'
            });
        }

        // 隐藏聊天框
        hide() {
            // 如果正在输入或有焦点，不要隐藏
            if (this.hasFocus() || this.isStreaming) {
                console.log('Prevented hiding chat box due to focus or streaming');
                return;
            }
            
            this.elements.container.classList.remove('show');
            this.chatVisible = false;
            // 不要在隐藏聊天框时重置输入框的显示状态
        }

        // 切换显示/隐藏
        toggle() {
            if (this.chatVisible) {
                this.hide();
            } else {
                this.show();
            }
        }

        // 添加消息到界面
        addMessage(role, content, isStreaming = false) {
            const messageEl = document.createElement('div');
            messageEl.className = `l2d-chat-message ${role}`;
            
            const bubbleEl = document.createElement('div');
            bubbleEl.className = 'l2d-chat-bubble';
            
            if (isStreaming && role === 'assistant') {
                bubbleEl.innerHTML = `
                    <div class="l2d-chat-typing">
                        <span></span><span></span><span></span>
                    </div>
                `;
            } else {
                bubbleEl.textContent = content;
            }
            
            messageEl.appendChild(bubbleEl);
            this.elements.messages.appendChild(messageEl);
            
            // 滚动到底部
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
            
            return bubbleEl;
        }

        // 发送消息
        async sendMessage() {
            const message = this.elements.input.value.trim();
            if (!message || this.isStreaming) return;

            // 添加用户消息
            this.addMessage('user', message);
            this.messages.push({ role: 'user', content: message });
            
            // 清空输入框
            this.elements.input.value = '';
            
            // 禁用输入
            this.elements.input.disabled = true;
            this.elements.sendBtn.disabled = true;
            this.isStreaming = true;

            // 添加 AI 回复占位符
            const aiMessageBubble = this.addMessage('assistant', '', true);

            try {
                // 准备请求数据
                const requestData = {
                    messages: this.messages.slice(-10), // 保留最近10条消息作为上下文
                    stream: true,
                    turnstileToken: this.turnstileToken
                };

                // 发送请求
                const response = await fetch(this.config.apiEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify(requestData)
                });

                if (!response.ok) {
                    let errorMessage = 'API request failed';
                    try {
                        const errorData = await response.json();
                        errorMessage = errorData.error || errorMessage;
                    } catch (e) {
                        // 如果无法解析 JSON，使用默认错误消息
                    }
                    throw new Error(errorMessage);
                }

                // 确认响应类型
                const contentType = response.headers.get('content-type');
                if (!contentType || !contentType.includes('text/event-stream')) {
                    console.warn('Unexpected content type:', contentType);
                }

                // 处理流式响应
                await this.handleStreamResponse(response, aiMessageBubble);

                // 检查是否需要重新验证
                if (this.config.requireTurnstile) {
                    // 重置验证状态，下次发送消息时需要重新验证
                    this.turnstileToken = null;
                    
                    // 如果配置了每次消息都需要验证，立即显示验证码
                    if (this.config.requireTurnstileEveryMessage) {
                        this.elements.turnstileContainer.innerHTML = '';
                        this.elements.turnstileContainer.style.display = 'flex';
                        this.elements.inputRow.style.display = 'none';
                        this.initTurnstile();
                    }
                }

            } catch (error) {
                console.error('Chat error:', error);
                const errorMessage = error.message || this.config.messages.error;
                aiMessageBubble.innerHTML = `<span style="color: #dc3545;">${errorMessage}</span>`;
            } finally {
                this.elements.input.disabled = false;
                this.elements.sendBtn.disabled = false;
                this.isStreaming = false;
                if (this.elements.inputRow.style.display !== 'none') {
                    this.elements.input.focus();
                }
            }
        }

        // 处理流式响应
        async handleStreamResponse(response, messageBubble) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let content = '';
            let isFirstChunk = true;
            let buffer = '';

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    // 解码并添加到缓冲区
                    buffer += decoder.decode(value, { stream: true });
                    
                    // 按行分割处理
                    const lines = buffer.split('\n');
                    
                    // 保留最后一行（可能不完整）
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6).trim();
                            
                            // 跳过特殊标记
                            if (data === '[DONE]') continue;
                            if (data === '') continue;

                            try {
                                const json = JSON.parse(data);
                                const delta = json.choices?.[0]?.delta?.content;
                                
                                if (delta) {
                                    if (isFirstChunk) {
                                        messageBubble.innerHTML = '';
                                        isFirstChunk = false;
                                    }
                                    content += delta;
                                    messageBubble.textContent = content;
                                    this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
                                }
                                
                                // 检查是否结束
                                if (json.choices?.[0]?.finish_reason) {
                                    break;
                                }
                            } catch (e) {
                                console.warn('Failed to parse SSE data:', data, e);
                            }
                        }
                    }
                }
                
                // 处理缓冲区中剩余的数据
                if (buffer.trim() && buffer.startsWith('data: ')) {
                    const data = buffer.slice(6).trim();
                    if (data && data !== '[DONE]') {
                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta?.content;
                            if (delta) {
                                content += delta;
                                messageBubble.textContent = content;
                            }
                        } catch (e) {
                            console.warn('Failed to parse final SSE data:', data, e);
                        }
                    }
                }
            } catch (error) {
                console.error('Stream reading error:', error);
                throw error;
            }

            // 如果没有收到任何内容，显示错误
            if (!content) {
                throw new Error('No response received from server');
            }

            // 保存 AI 回复到上下文
            this.messages.push({ role: 'assistant', content: content });
        }

        // 注入样式
        injectStyles() {
            const styles = `
                /* 悬停区域样式 */
                .l2d-hover-area {
                    background: transparent;
                    pointer-events: auto;
                }

                .l2d-hover-area:hover {
                    background: rgba(255, 255, 255, 0.1);
                }

                /* 聊天容器样式 */
                .l2d-chat-container {
                    position: fixed;
                    bottom: 20px;
                    width: 350px;
                    height: 500px;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
                    display: flex;
                    flex-direction: column;
                    z-index: 99999;
                    backdrop-filter: blur(10px);
                    opacity: 0;
                    transform: translateY(20px);
                    transition: all 0.3s ease;
                    pointer-events: none;
                }

                .l2d-chat-container.right {
                    right: 170px; /* 调整为适应 Live2D 宽度 */
                }

                .l2d-chat-container.left {
                    left: 170px;
                }

                .l2d-chat-container.show {
                    opacity: 1;
                    transform: translateY(0);
                    pointer-events: auto;
                }

                /* Dark theme */
                .l2d-chat-container.dark {
                    background: rgba(30, 30, 30, 0.95);
                    color: #fff;
                }

                .l2d-chat-container.dark .l2d-chat-header {
                    background: linear-gradient(135deg, #434343 0%, #262626 100%);
                }

                .l2d-chat-container.dark .l2d-chat-messages {
                    background: #1a1a1a;
                }

                .l2d-chat-container.dark .l2d-chat-input {
                    background: #2a2a2a;
                    color: #fff;
                    border-color: #444;
                }

                .l2d-chat-container.dark .l2d-chat-message.assistant .l2d-chat-bubble {
                    background: #2a2a2a;
                    color: #fff;
                }

                /* Cute theme */
                .l2d-chat-container.cute .l2d-chat-header {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                .l2d-chat-container.cute .l2d-chat-send {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                .l2d-chat-container.cute .l2d-chat-message.user .l2d-chat-bubble {
                    background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
                }

                /* Header */
                .l2d-chat-header {
                    padding: 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border-radius: 12px 12px 0 0;
                    font-weight: bold;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    user-select: none;
                }

                .l2d-chat-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.8;
                    transition: opacity 0.2s;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .l2d-chat-close:hover {
                    opacity: 1;
                }

                /* Messages container */
                .l2d-chat-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                    background: #f7f7f8;
                }

                .l2d-chat-message {
                    margin-bottom: 15px;
                    animation: l2d-message-slide 0.3s ease;
                }

                @keyframes l2d-message-slide {
                    from {
                        opacity: 0;
                        transform: translateX(-10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }

                .l2d-chat-message.user {
                    text-align: right;
                }

                .l2d-chat-message.assistant {
                    text-align: left;
                }

                .l2d-chat-bubble {
                    display: inline-block;
                    max-width: 80%;
                    padding: 10px 15px;
                    border-radius: 18px;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                }

                .l2d-chat-message.user .l2d-chat-bubble {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }

                .l2d-chat-message.assistant .l2d-chat-bubble {
                    background: white;
                    color: #333;
                    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
                }

                .l2d-chat-message.system {
                    text-align: center;
                    margin: 10px 0;
                }

                .l2d-chat-message.system .l2d-chat-bubble {
                    background: #f0f0f0;
                    color: #666;
                    font-size: 13px;
                    padding: 8px 12px;
                    border-radius: 12px;
                }

                /* Input container */
                .l2d-chat-input-container {
                    padding: 15px;
                    background: white;
                    border-top: 1px solid #e0e0e0;
                    border-radius: 0 0 12px 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    min-height: 70px; /* 固定最小高度，防止跳动 */
                }

                /* Turnstile container */
                .l2d-turnstile-container {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 50px;
                    transition: all 0.3s ease;
                }

                .l2d-turnstile-container:empty {
                    display: none;
                }

                /* 调整 Turnstile widget 样式 */
                .l2d-turnstile-container > div {
                    transform: scale(0.85);
                    transform-origin: center;
                }

                /* Input row */
                .l2d-chat-input-row {
                    display: flex;
                    gap: 10px;
                }

                .l2d-chat-input-row.show-animation {
                    animation: l2d-fadein 0.3s ease;
                }

                @keyframes l2d-fadein {
                    from {
                        opacity: 0;
                        transform: translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }

                .l2d-chat-input {
                    flex: 1;
                    padding: 10px 15px;
                    border: 1px solid #e0e0e0;
                    border-radius: 25px;
                    outline: none;
                    font-size: 14px;
                    transition: border-color 0.3s;
                    background: white;
                }

                .l2d-chat-input:focus {
                    border-color: #667eea;
                }

                .l2d-chat-input:disabled {
                    opacity: 0.6;
                }

                .l2d-chat-send {
                    padding: 10px 15px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    transition: transform 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 40px;
                    height: 40px;
                }

                .l2d-chat-send:hover:not(:disabled) {
                    transform: scale(1.05);
                }

                .l2d-chat-send:active {
                    transform: scale(0.95);
                }

                .l2d-chat-send:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* Typing indicator */
                .l2d-chat-typing {
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    height: 20px; /* 固定高度与单行文本一致 */
                    padding: 0; /* 确保没有额外的内边距 */
                    margin: 0; /* 确保没有额外的外边距 */
                }

                .l2d-chat-typing span {
                    display: inline-block;
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background-color: #666;
                    animation: l2d-typing 1.4s infinite;
                }

                .l2d-chat-typing span:nth-child(2) {
                    animation-delay: 0.2s;
                }

                .l2d-chat-typing span:nth-child(3) {
                    animation-delay: 0.4s;
                }

                @keyframes l2d-typing {
                    0%, 60%, 100% {
                        transform: translateY(0);
                        opacity: 0.4;
                    }
                    30% {
                        transform: translateY(-6px);
                        opacity: 1;
                    }
                }

                /* 确保加载中的气泡样式正确 */
                .l2d-chat-message.assistant .l2d-chat-bubble {
                    min-height: 20px; /* 确保最小高度 */
                    display: flex;
                    align-items: center;
                }

                /* Scrollbar */
                .l2d-chat-messages::-webkit-scrollbar {
                    width: 6px;
                }

                .l2d-chat-messages::-webkit-scrollbar-track {
                    background: #f1f1f1;
                    border-radius: 3px;
                }

                .l2d-chat-messages::-webkit-scrollbar-thumb {
                    background: #888;
                    border-radius: 3px;
                }

                .l2d-chat-messages::-webkit-scrollbar-thumb:hover {
                    background: #555;
                }

                /* Mobile responsive */
                @media (max-width: 768px) {
                    .l2d-chat-container {
                        width: calc(100vw - 40px);
                        height: 400px;
                        right: 20px !important;
                        left: 20px !important;
                        bottom: 10px;
                    }

                    .l2d-hover-area {
                        display: none;
                    }
                }
            `;

            const styleEl = document.createElement('style');
            styleEl.textContent = styles;
            document.head.appendChild(styleEl);
        }
    }

    // 导出到全局
    window.L2DChatExtension = L2DChatExtension;

    // 自动初始化（可选）
    if (window.L2DChatAutoInit !== false) {
        document.addEventListener('DOMContentLoaded', () => {
            // 等待 Live2D 初始化完成
            setTimeout(() => {
                window.l2dChat = new L2DChatExtension(window.L2DChatConfig || {});
            }, 1000);
        });
    }
})();

/* 使用示例：

// 方式1：自动初始化（默认配置）
// 只需要引入脚本即可

// 方式2：手动初始化（自定义配置）
window.L2DChatAutoInit = false; // 禁用自动初始化
document.addEventListener('DOMContentLoaded', () => {
    const chat = new L2DChatExtension({
        apiEndpoint: '/api/chat',
        position: 'right',
        theme: 'cute',
        showOnHover: true,
        requireTurnstile: true,
        turnstileSiteKey: 'YOUR_SITE_KEY',
        requireTurnstileEveryMessage: false, // 是否每条消息都需要验证
        messages: {
            placeholder: '想和我聊什么呢？',
            title: 'Live2D 助手',
            error: '哎呀，出错了呢~',
            thinking: '让我想想...'
        }
    });
});

// 方式3：通过全局配置
window.L2DChatConfig = {
    theme: 'dark',
    position: 'left',
    showOnHover: false,  // 禁用悬停，只通过点击触发
    requireTurnstile: true,
    turnstileSiteKey: 'YOUR_SITE_KEY'
};
// 然后引入脚本，会自动使用配置

// 方式4：自定义悬停区域
window.L2DChatConfig = {
    hoverArea: document.getElementById('my-custom-hover-area'),
    showOnHover: true
};

*/
