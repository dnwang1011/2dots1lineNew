// Add error handling for authentication errors

// Define API base URL
window.apiBaseUrl = 'http://localhost:3002/api';

// Global variable to track current attachment
let currentAttachment = null;

// Handle sending messages
function sendMessage() {
  const messageInput = document.getElementById('message-input');
  const message = messageInput.value.trim();
  
  if (!message && !currentAttachment) return;
  
  // Clear the input
  messageInput.value = '';
  
  // Get the token from session storage
  const token = sessionStorage.getItem('token');
  if (!token) {
    addSystemMessage('Authentication required. Please sign in.');
    document.getElementById('authOverlay').style.display = 'flex';
    return;
  }
  
  // Handle file upload if there's an attachment
  if (currentAttachment) {
    // Add a temporary user message for the attachment upload
    const tempMessageId = 'temp-msg-' + Date.now();
    // We will replace this or update it after upload success
    addUserMessage(`Uploading ${currentAttachment.type === 'image' ? 'image' : 'file'}...`, tempMessageId, null);

    // Store the attachment details *before* clearing it, so we can display it
    const attachmentDetailsForDisplay = { ...currentAttachment };

    // First upload the file, passing the user's message along with it
    uploadFile(currentAttachment.file, currentAttachment.type, message)
      .then(uploadResponse => {
        // Remove the temporary message
        const tempMessageElement = document.getElementById(tempMessageId);
        if (tempMessageElement) {
            tempMessageElement.remove();
        }

        if (uploadResponse && uploadResponse.success) {
          // Always add the user message (with attachment) to the UI now
          const messageId = 'msg-' + Date.now();
          // If user didn't type a message, create a default one
          const messageText = message || `Sharing ${attachmentDetailsForDisplay.type === 'image' ? 'an image' : 'a file'}: ${attachmentDetailsForDisplay.file.name}`;
          addUserMessage(messageText, messageId, attachmentDetailsForDisplay);

          // Clear the current attachment state (not the details we saved for display)
          clearAttachment();

          // **** Display the AI analysis response from the upload result ****
          // Corrected: Look inside uploadResponse.data.analysisText
          if (uploadResponse.data && uploadResponse.data.analysisText) {
            addBotMessage(uploadResponse.data.analysisText);
          } else {
             // Log if the structure is wrong or text is missing
             console.warn('Upload successful, but data.analysisText was missing:', uploadResponse);
             addSystemMessage('File uploaded, but no analysis available.');
          }

        } else {
          addSystemMessage(`Failed to upload ${currentAttachment?.type || 'file'}: ${uploadResponse.message || 'Unknown error'}`);
          clearAttachment();
        }
      })
      .catch(error => {
        // Remove the temporary message on error
        const tempMessageElement = document.getElementById(tempMessageId);
        if (tempMessageElement) {
            tempMessageElement.remove();
        }
        addSystemMessage(`Error uploading ${currentAttachment.type}: ${error.message}`);
        clearAttachment();
      });
  } else if (message) {
    // Only add user message and send to server if there is text content and no attachment
    const messageId = 'msg-' + Date.now();
    addUserMessage(message, messageId, null);
    // Just send the text message to the server
    sendMessageToServer(message);
  }
}

// Helper function to send message to server
function sendMessageToServer(message) {
  const token = sessionStorage.getItem('token');
  if (!token) return;
  
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      session_id: getSessionId(),
      message_type: 'chat',
      raw_data: {
        message: message,
        source: 'chat_interface'
      }
    })
  };
  
  // Send the message to the server
  fetch(`${window.apiBaseUrl}/chat`, requestOptions)
    .then(response => {
      if (!response.ok) {
        if (response.status === 401) {
          document.getElementById('authOverlay').style.display = 'flex';
          throw new Error('Authentication required. Please sign in.');
        }
        throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
      }
      return response.json();
    })
    .then(data => {
      if (data && data.success) {
        if (data.data && data.data.text) { 
          addBotMessage(data.data.text);
        } else {
          console.warn('Received success response but text field is missing in data.data:', data);
          addSystemMessage('Received success, but no response text from Dot.');
        }
      } else {
        const errorMessage = data.error?.message || data.error || 'Failed to get response from server';
        throw new Error(errorMessage);
      }
    })
    .catch(error => {
      addSystemMessage(`Error: ${error.message}`);
      if (error.message.includes('Authentication required')) {
        sessionStorage.removeItem('token');
      }
    });
}

// Upload a file to the server
function uploadFile(file, fileType, message) {
  const token = sessionStorage.getItem('token');
  if (!token) {
    addSystemMessage('Authentication required. Please sign in.');
    document.getElementById('authOverlay').style.display = 'flex';
    return Promise.reject(new Error('Authentication required'));
  }
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', getSessionId());
  formData.append('file_type', fileType); // Optional metadata
  // Append the message if it exists
  if (message && message.trim() !== '') {
    formData.append('message', message);
  }
  
  return fetch(`${window.apiBaseUrl}/chat/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  })
  .then(response => {
    if (!response.ok) {
      if (response.status === 401) {
        document.getElementById('authOverlay').style.display = 'flex';
        throw new Error('Authentication required. Please sign in.');
      }
      throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
    }
    return response.json();
  })
  .then(data => {
    return data;
  })
  .catch(error => {
    addSystemMessage(`Error uploading file: ${error.message}`);
    return { success: false, message: error.message };
  });
}

// Handle file selection for both images and documents
function handleFileSelection(file, type) {
  if (!file) return;
  
  // Check file size (10MB limit)
  const maxSize = 10 * 1024 * 1024; // 10MB in bytes
  if (file.size > maxSize) {
    addSystemMessage(`File is too large. Please select a file under 10MB.`);
    return;
  }
  
  // Check file type
  if (type === 'image' && !file.type.startsWith('image/')) {
    addSystemMessage('Please select a valid image file.');
    return;
  }
  
  if (type === 'file' && !['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].includes(file.type)) {
    addSystemMessage('Please select a valid document (PDF, DOC, DOCX, or TXT).');
    return;
  }
  
  // Store the attachment
  currentAttachment = { file, type };
  
  // Show attachment preview
  displayAttachmentPreview(file, type);
  
  // Enable send button
  const sendButton = document.querySelector('.chat-send-button');
  if (sendButton) {
    sendButton.disabled = false;
  }
}

// Display attachment preview
function displayAttachmentPreview(file, type) {
  const attachmentsContainer = document.getElementById('attachments-container');
  if (!attachmentsContainer) return;
  
  // Clear any existing previews
  attachmentsContainer.innerHTML = '';
  
  // Create preview element
  const previewDiv = document.createElement('div');
  previewDiv.className = 'attachment-preview';
  
  if (type === 'image' && file.type.startsWith('image/')) {
    // Create preview for images
    const reader = new FileReader();
    reader.onload = function(e) {
      previewDiv.innerHTML = `
        <img src="${e.target.result}" alt="Image preview">
        <div class="file-name">${file.name}</div>
        <button class="remove-button" onclick="clearAttachment()">
          <i data-feather="x"></i>
        </button>
      `;
      attachmentsContainer.appendChild(previewDiv);
      feather.replace();
    };
    reader.readAsDataURL(file);
  } else {
    // Create preview for other files
    previewDiv.innerHTML = `
      <i data-feather="file" style="margin-right: 0.5rem; color: #4f46e5;"></i>
      <div class="file-name">${file.name}</div>
      <button class="remove-button" onclick="clearAttachment()">
        <i data-feather="x"></i>
      </button>
    `;
    attachmentsContainer.appendChild(previewDiv);
    feather.replace();
  }
}

// Clear the current attachment
function clearAttachment() {
  currentAttachment = null;
  
  const attachmentsContainer = document.getElementById('attachments-container');
  if (attachmentsContainer) {
    attachmentsContainer.innerHTML = '';
  }
  
  // Disable send button if text input is also empty
  const messageInput = document.getElementById('message-input');
  const sendButton = document.querySelector('.chat-send-button');
  if (sendButton && messageInput) {
    sendButton.disabled = messageInput.value.trim() === '';
  }
  
  // Reset file input elements
  const fileInput = document.getElementById('file-input');
  const imageInput = document.getElementById('image-input');
  if (fileInput) fileInput.value = '';
  if (imageInput) imageInput.value = '';
}

// Get session ID from storage or create new one
function getSessionId() {
  // Check if the page was just loaded (which would indicate a new session)
  const isNewPageLoad = !window.sessionStartTime;
  
  // If this is a new page load, set the current time as the session start time
  if (isNewPageLoad) {
    window.sessionStartTime = Date.now();
    // Generate a new session ID
    const newSessionId = 'session-' + Date.now();
    // Store it in sessionStorage
    sessionStorage.setItem('chatSessionId', newSessionId);
    return newSessionId;
  }
  
  // Retrieve existing session ID
  let sessionId = sessionStorage.getItem('chatSessionId');
  if (!sessionId) {
    // Fallback if no session ID exists (should not normally happen)
    sessionId = 'session-' + Date.now();
    sessionStorage.setItem('chatSessionId', sessionId);
  }
  
  return sessionId;
}

// Function to explicitly create a new session (can be called on user action like "New Chat")
function createNewSession() {
  const newSessionId = 'session-' + Date.now();
  sessionStorage.setItem('chatSessionId', newSessionId);
  window.sessionStartTime = Date.now();
  return newSessionId;
}

// Add a user message to the chat
function addUserMessage(message, messageId, attachment) {
  const chatMessages = document.querySelector('.chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user-message';
  messageDiv.id = messageId;
  
  const avatar = '<div class="message-avatar" style="background-color: #6366f1; display: flex; align-items: center; justify-content: center; color: white;"><i data-feather="user" style="width: 20px; height: 20px;"></i></div>';
  const messageTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Create attachment HTML if attachment exists
  let attachmentHtml = '';
  if (attachment && attachment.file) {
      if (attachment.type === 'image' && attachment.file.type.startsWith('image/')) {
          // Generate a temporary URL for the image thumbnail
          const objectURL = URL.createObjectURL(attachment.file);
          // Add class for styling and potentially click handler later
          attachmentHtml = `
              <div class="message-attachment image-attachment">
                  <img src="${objectURL}" alt="${escapeHtml(attachment.file.name)}" style="max-width: 150px; max-height: 100px; border-radius: 4px; cursor: pointer;" onclick="showImageModal('${objectURL}')">
              </div>
          `;
          // Note: Consider revoking the object URL later to free memory, 
          // perhaps when the message scrolls out of view or after some time.
          // URL.revokeObjectURL(objectURL); // Example - needs proper timing
      } else {
          // Simple display for non-image files
          attachmentHtml = `
              <div class="message-attachment file-attachment" style="display: flex; align-items: center; background-color: #f3f4f6; padding: 5px 10px; border-radius: 4px; margin-top: 5px;">
                  <i data-feather="file" style="width: 16px; height: 16px; margin-right: 5px; color: #4b5563;"></i>
                  <span style="font-size: 0.8rem; color: #374151;">${escapeHtml(attachment.file.name)}</span>
              </div>
          `;
      }
  }

  messageDiv.innerHTML = `
    <div>
      <div class="message-content">
        ${attachmentHtml} 
        <p>${escapeHtml(message)}</p> 
      </div>
      <div class="message-time">${messageTime}</div>
    </div>
    ${avatar}
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  feather.replace();
}

// Add a modal for viewing images
function showImageModal(imageSrc) {
    let modal = document.getElementById('imageModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'imageModal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.zIndex = '1000';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.overflow = 'auto';
        modal.style.backgroundColor = 'rgba(0,0,0,0.8)';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';

        const modalContent = document.createElement('img');
        modalContent.id = 'modalImageContent';
        modalContent.style.maxWidth = '80%';
        modalContent.style.maxHeight = '80%';
        modalContent.style.display = 'block';
        modalContent.style.margin = 'auto';

        const closeButton = document.createElement('span');
        closeButton.innerHTML = '&times;';
        closeButton.style.position = 'absolute';
        closeButton.style.top = '20px';
        closeButton.style.right = '35px';
        closeButton.style.color = '#f1f1f1';
        closeButton.style.fontSize = '40px';
        closeButton.style.fontWeight = 'bold';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = function() {
            modal.style.display = 'none';
        }

        modal.appendChild(closeButton);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Close modal on click outside image
        modal.onclick = function(event) {
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        }
    }

    // Set the image source and display the modal
    document.getElementById('modalImageContent').src = imageSrc;
    modal.style.display = 'flex'; // Use flex for centering
}

// Add a bot message to the chat
function addBotMessage(message) {
  const chatMessages = document.querySelector('.chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message bot-message';
  
  const avatar = '<img src="images/dotai.jpeg" alt="Dot" class="message-avatar">';
  const messageTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  // Handle both string messages and response objects
  let messageText = message;
  if (typeof message === 'object' && message !== null) {
    messageText = message.text || JSON.stringify(message);
  }
  
  // Format the message text to preserve line breaks and add styling
  const formattedMessage = formatMessageText(messageText);
  
  messageDiv.innerHTML = `
    ${avatar}
    <div>
      <div class="message-content">
        ${formattedMessage}
      </div>
      <div class="message-time">${messageTime}</div>
    </div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Helper function to escape HTML and prevent XSS
function escapeHtml(unsafe) {
  // Ensure we have a string to work with
  if (unsafe === undefined || unsafe === null) {
    return '';
  }
  
  // Convert to string if it's not already
  const safeString = String(unsafe);
  
  return safeString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Format message text to preserve formatting
function formatMessageText(text) {
  if (!text) return '';

  // Start with the raw text
  let formattedText = text;

  // --- Phase 1: Basic Replacements & Initial Cleanup ---

  // 1. Replace newline characters with <br> tags for HTML display
  formattedText = formattedText.replace(/\n/g, '<br>');

  // 2. Remove any stray "message-list"> artifacts
  formattedText = formattedText.replace(/"message-list">/g, '');

  // --- Phase 2: Markdown-to-HTML Conversion ---

  // 3. Process Lists with proper hierarchy
  
  // Process nested bullet points and maintain hierarchy
  let linesBullet = formattedText.split('<br>');
  let resultBullet = '';
  let inBulletList = false;
  let indentLevel = 0;
  let indentStack = [];
  
  linesBullet.forEach((line, index) => {
    let trimmedLine = line.trim();
    
    // Count leading spaces to determine indentation level
    const leadingSpaces = line.search(/\S|$/);
    const currentIndent = Math.floor(leadingSpaces / 2); // 2 spaces = 1 indent level
    
    // Check if line starts with a bullet marker
    const bulletMatch = trimmedLine.match(/^([*-] )(.*)/);
    
    if (bulletMatch) {
      if (!inBulletList) {
        // Start a new list
        resultBullet += '<ul class="message-list" style="margin: 0.5rem 0; padding-left: 1.5rem;">';
        inBulletList = true;
        indentLevel = currentIndent;
        indentStack = [currentIndent];
      } else {
        // Handle indentation changes
        if (currentIndent > indentStack[indentStack.length - 1]) {
          // Increasing indent - start a new nested list
          resultBullet += '<ul class="message-list" style="margin: 0.25rem 0; padding-left: 1.5rem;">';
          indentStack.push(currentIndent);
        } else if (currentIndent < indentStack[indentStack.length - 1]) {
          // Decreasing indent - close appropriate number of lists
          while (indentStack.length > 0 && currentIndent < indentStack[indentStack.length - 1]) {
            resultBullet += '</li></ul>';
            indentStack.pop();
          }
          // Close the previous list item
          resultBullet += '</li>';
        } else {
          // Same indent level - close previous list item
          resultBullet += '</li>';
        }
      }
      
      // Add list item with better spacing
      resultBullet += `<li style="margin-bottom: 0.25rem;">${bulletMatch[2]}`;
    } else {
      if (inBulletList) {
        // Close all open lists when we exit the list block
        while (indentStack.length > 0) {
          resultBullet += '</li></ul>';
          indentStack.pop();
        }
        inBulletList = false;
      }
      
      // Don't add <br> after a list (which would create extra spacing)
      if (trimmedLine || !resultBullet.endsWith('</ul>')) {
        resultBullet += line + (index < linesBullet.length - 1 ? '<br>' : '');
      } else {
        // If this is an empty line after a list, don't add a break
        resultBullet += line;
      }
    }
  });
  
  // Ensure all lists are properly closed
  if (inBulletList) {
    while (indentStack.length > 0) {
      resultBullet += '</li></ul>';
      indentStack.pop();
    }
  }
  
  formattedText = resultBullet;

  // Process numbered lists with similar hierarchical approach
  let linesNumbered = formattedText.split('<br>');
  let resultNumbered = '';
  let inNumberedList = false;
  indentLevel = 0;
  indentStack = [];
  
  linesNumbered.forEach((line, index) => {
    let trimmedLine = line.trim();
    // Skip lines that are already part of HTML lists
    if (trimmedLine.includes('<ul') || trimmedLine.includes('<ol') || 
        trimmedLine.includes('</ul>') || trimmedLine.includes('</ol>') ||
        trimmedLine.includes('<li>') || trimmedLine.includes('</li>')) {
      resultNumbered += line + (index < linesNumbered.length - 1 ? '<br>' : '');
      return;
    }
    
    // Count leading spaces to determine indentation level
    const leadingSpaces = line.search(/\S|$/);
    const currentIndent = Math.floor(leadingSpaces / 2);
    
    // Check if line starts with a number
    const numberMatch = trimmedLine.match(/^(\d+\.\s)(.*)/);
    
    if (numberMatch) {
      if (!inNumberedList) {
        // Start a new numbered list
        resultNumbered += '<ol class="message-list" style="margin: 0.5rem 0; padding-left: 1.5rem;">';
        inNumberedList = true;
        indentLevel = currentIndent;
        indentStack = [currentIndent];
      } else {
        // Handle indentation changes similar to bullet lists
        if (currentIndent > indentStack[indentStack.length - 1]) {
          resultNumbered += '<ol class="message-list" style="margin: 0.25rem 0; padding-left: 1.5rem;">';
          indentStack.push(currentIndent);
        } else if (currentIndent < indentStack[indentStack.length - 1]) {
          while (indentStack.length > 0 && currentIndent < indentStack[indentStack.length - 1]) {
            resultNumbered += '</li></ol>';
            indentStack.pop();
          }
          resultNumbered += '</li>';
        } else {
          resultNumbered += '</li>';
        }
      }
      
      resultNumbered += `<li style="margin-bottom: 0.25rem;">${numberMatch[2]}`;
    } else {
      if (inNumberedList) {
        while (indentStack.length > 0) {
          resultNumbered += '</li></ol>';
          indentStack.pop();
        }
        inNumberedList = false;
      }
      
      if (trimmedLine || !resultNumbered.endsWith('</ol>')) {
        resultNumbered += line + (index < linesNumbered.length - 1 ? '<br>' : '');
      } else {
        resultNumbered += line;
      }
    }
  });
  
  if (inNumberedList) {
    while (indentStack.length > 0) {
      resultNumbered += '</li></ol>';
      indentStack.pop();
    }
  }
  
  formattedText = resultNumbered;

  // --- Phase 3: Inline Formatting (Bold/Italic) ---
  // Apply these *after* list structures are built

  // 4. Process bold text (**...**)
  formattedText = formattedText.replace(/\*\*([^*<>]+)\*\*/g, '<strong>$1</strong>');

  // 5. Process italic text (*...*)
  formattedText = formattedText.replace(/(?<![*-] )\*([^*<>]+)\*(?![^<>]*>)/g, '<em>$1</em>');

  // --- Phase 4: Final Cleanup ---

  // Remove empty list tags that might result from processing
  formattedText = formattedText.replace(/<ul class="message-list"[^>]*><\/ul>/g, '');
  formattedText = formattedText.replace(/<ol class="message-list"[^>]*><\/ol>/g, '');
  
  // Remove potential double <br> tags from list processing
  formattedText = formattedText.replace(/<br><br>/g, '<br>');
  
  // Remove <br> that might appear right after a list closing tag
  formattedText = formattedText.replace(/<\/ul><br>/g, '</ul>');
  formattedText = formattedText.replace(/<\/ol><br>/g, '</ol>');

  return formattedText;
}

// Add a system message to the chat
function addSystemMessage(message) {
  const chatMessages = document.querySelector('.chat-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message system-message';
  
  const avatar = '<div class="message-avatar" style="background-color: #4b5563; display: flex; align-items: center; justify-content: center; color: white;"><i data-feather="info" style="width: 20px; height: 20px;"></i></div>';
  const messageTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  messageDiv.innerHTML = `
    ${avatar}
    <div>
      <div class="message-content">
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="message-time">${messageTime}</div>
    </div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  feather.replace();
}

// Initialize chat
document.addEventListener('DOMContentLoaded', () => {
  // Check authentication
  const token = sessionStorage.getItem('token');
  if (!token) {
    document.getElementById('authOverlay').style.display = 'flex';
  }
  
  // Set up message input
  const messageForm = document.querySelector('.chat-input-form');
  const messageInput = document.getElementById('message-input');
  const sendButton = document.querySelector('.chat-send-button');
  const fileInput = document.getElementById('file-input');
  const imageInput = document.getElementById('image-input');
  const attachFileButton = document.getElementById('attach-file-button');
  const attachImageButton = document.getElementById('attach-image-button');
  const voiceInputButton = document.getElementById('voice-input-button');
  const attachmentsContainer = document.getElementById('attachments-container');
  const recordingIndicator = document.getElementById('recording-indicator');
  
  // Add initial greeting
  addBotMessage("Hi! I'm Dot, your AI companion. How can I help you today?");
  
  // Set up form submission
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // Only call sendMessage on form submit if there is NO attachment.
    // File uploads are handled when the file is selected/attached.
    if (!currentAttachment) {
      sendMessage();
    }
  });
  
  // Set up file attachment
  if (attachFileButton) {
    attachFileButton.addEventListener('click', () => {
      fileInput.click();
    });
  }
  
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelection(e.target.files[0], 'file');
      }
    });
  }
  
  // Set up image attachment
  if (attachImageButton) {
    attachImageButton.addEventListener('click', () => {
      imageInput.click();
    });
  }
  
  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelection(e.target.files[0], 'image');
      }
    });
  }
  
  // Set up voice input
  if (voiceInputButton) {
    let recognition;
    let isRecording = false;
    
    // Check if browser supports SpeechRecognition
    if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) {
      // Initialize SpeechRecognition
      recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      // Set up voice input button
      voiceInputButton.addEventListener('click', () => {
        if (!isRecording) {
          // Start recording
          try {
            recognition.start();
            isRecording = true;
            voiceInputButton.classList.add('recording');
            if (recordingIndicator) {
              recordingIndicator.style.display = 'flex';
            }
            addSystemMessage('Listening... Speak now.');
          } catch (error) {
            addSystemMessage('Could not access microphone. Please check permissions.');
          }
        } else {
          // Stop recording
          recognition.stop();
          isRecording = false;
          voiceInputButton.classList.remove('recording');
          if (recordingIndicator) {
            recordingIndicator.style.display = 'none';
          }
        }
      });
      
      // Handle results
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
          .map(result => result[0])
          .map(result => result.transcript)
          .join('');
        
        messageInput.value = transcript;
        sendButton.disabled = transcript.trim() === '';
      };
      
      // Handle end of speech
      recognition.onend = () => {
        isRecording = false;
        voiceInputButton.classList.remove('recording');
        if (recordingIndicator) {
          recordingIndicator.style.display = 'none';
        }
      };
      
      // Handle errors
      recognition.onerror = (event) => {
        addSystemMessage(`Error: ${event.error}`);
        isRecording = false;
        voiceInputButton.classList.remove('recording');
        if (recordingIndicator) {
          recordingIndicator.style.display = 'none';
        }
      };
    } else {
      // Browser doesn't support speech recognition
      voiceInputButton.addEventListener('click', () => {
        addSystemMessage('Speech recognition is not supported in your browser. Please try Chrome or Edge.');
      });
    }
  }
  
  // Enable/disable send button based on input
  messageInput.addEventListener('input', () => {
    sendButton.disabled = messageInput.value.trim() === '' && !currentAttachment;
  });
  
  // Initialize Feather icons
  if (feather) {
    feather.replace();
  }
  
  // Make clearAttachment globally available
  window.clearAttachment = clearAttachment;
}); 