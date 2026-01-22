import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  files?: { name: string; type: string }[];
  sources?: Array<{
    index: number;
    text: string;
    score?: number;
  }>;
}

interface HistoryItem {
  id: string;
  document_name: string;
  created_at: string;
  has_mindmap: boolean;
}

interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sendMessage: (content: string, model?: string) => Promise<void>;
  uploadFile: (file: File) => Promise<void>;
  clearChat: () => Promise<void>;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  isLoading: boolean;
  hasUploadedFile: boolean;
  uploadVersion: number;  // Increments on each upload to trigger mindmap refresh
  // History-related
  history: HistoryItem[];
  selectedHistoryId: string | null;
  loadHistory: () => Promise<void>;
  selectHistoryItem: (id: string) => Promise<void>;
  deleteHistoryItem: (id: string) => Promise<void>;
  currentMindmapData: any | null;  // The mindmap data from selected history
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedModel, setSelectedModel] = useState('gpt-5.1');
  const [isLoading, setIsLoading] = useState(false);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [uploadVersion, setUploadVersion] = useState(0);  // Increments on each upload
  const messagesRef = useRef<Message[]>([]);

  // History state
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [currentMindmapData, setCurrentMindmapData] = useState<any | null>(null);

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const sendMessage = useCallback(async (content: string, model?: string) => {
    if (!content.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: content,
    };

    // Update both state and ref
    setMessages(prev => {
      const newMessages = [...prev, userMessage];
      messagesRef.current = newMessages;
      return newMessages;
    });
    setIsLoading(true);

    try {
      const apiUrl = import.meta.env.DEV
        ? 'http://localhost:8000/api/chat'
        : '/api/chat';

      // Use ref to get current messages for the request (includes the user message we just added)
      const messagesForRequest = messagesRef.current.map(m => ({ role: m.role, content: m.content }));

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: messagesForRequest,
          model: model || selectedModel
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get response from server');
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || 'No response',
        sources: data.sources || []
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: Failed to get response from backend. Make sure the Python server is running.'
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedModel]);

  const uploadFile = useCallback(async (file: File) => {
    setIsLoading(true);

    try {
      const apiUrl = import.meta.env.DEV
        ? 'http://localhost:8000/api/upload'
        : '/api/upload';

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        // Try to get error details from response
        let errorDetail = 'Failed to upload file';
        try {
          const errorData = await response.json();
          errorDetail = errorData.detail || errorData.message || errorDetail;
        } catch (e) {
          const errorText = await response.text();
          errorDetail = errorText || errorDetail;
        }
        throw new Error(errorDetail);
      }

      await response.json();

      // Show success message
      const assistantMessage: Message = {
        role: 'assistant',
        content: `✅ Document "${file.name}" has been successfully uploaded and processed. You can now ask questions about it!`
      };

      setMessages([assistantMessage]);
      messagesRef.current = [assistantMessage];
      setHasUploadedFile(true);
      setSelectedHistoryId(null);  // Clear any selected history
      setCurrentMindmapData(null);  // Clear cached mindmap data so it fetches fresh
      setUploadVersion(prev => prev + 1);  // Increment to trigger mindmap refresh

      // Reload history to include the new upload
      await loadHistory();
    } catch (error) {
      console.error('Error uploading file:', error);
      let errorMessage = '❌ Error: Failed to upload file.';

      // Try to get more details from the error
      if (error instanceof Error) {
        errorMessage += `\n\n${error.message}`;
      } else {
        errorMessage += '\n\nPlease make sure the file is a valid PDF, DOCX, TXT, or MD document and the backend server is running.';
      }

      const errorMsg: Message = {
        role: 'assistant',
        content: errorMessage
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearChat = useCallback(async () => {
    // Clear frontend state
    setMessages([]);
    setHasUploadedFile(false);
    setSelectedHistoryId(null);
    setCurrentMindmapData(null);
    messagesRef.current = [];

    // Clear backend document text
    try {
      const apiUrl = import.meta.env.DEV
        ? 'http://localhost:8000/api/clear'
        : '/api/clear';

      await fetch(apiUrl, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Error clearing backend context:', error);
      // Continue anyway - frontend is already cleared
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const apiUrl = import.meta.env.DEV
        ? 'http://localhost:8000/api/history'
        : '/api/history';

      const response = await fetch(apiUrl);
      if (response.ok) {
        const data = await response.json();
        setHistory(data.items || []);
      }
    } catch (error) {
      console.error('Error loading history:', error);
    }
  }, []);

  const selectHistoryItem = useCallback(async (id: string) => {
    setIsLoading(true);
    try {
      const baseUrl = import.meta.env.DEV ? 'http://localhost:8000' : '';

      // First, get the mindmap data
      const response = await fetch(`${baseUrl}/api/history/${id}`);
      if (!response.ok) {
        throw new Error('Failed to load history item');
      }

      const data = await response.json();

      // Also load the document context for chat
      try {
        await fetch(`${baseUrl}/api/history/${id}/select`, { method: 'POST' });
      } catch (e) {
        console.warn('Could not load document context:', e);
      }

      // Set the mindmap data and mark as having a file
      setCurrentMindmapData(data.mindmap);
      setSelectedHistoryId(id);
      setHasUploadedFile(true);
      setUploadVersion(prev => prev + 1);  // Trigger mindmap refresh

      // Add a message indicating history was loaded
      const assistantMessage: Message = {
        role: 'assistant',
        content: `📂 Loaded document "${data.document_name}" from history. You can now view the mind map and ask questions about it!`
      };
      setMessages([assistantMessage]);
      messagesRef.current = [assistantMessage];

    } catch (error) {
      console.error('Error loading history item:', error);
      const errorMsg: Message = {
        role: 'assistant',
        content: '❌ Error: Failed to load document from history.'
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteHistoryItem = useCallback(async (id: string) => {
    try {
      const apiUrl = import.meta.env.DEV
        ? `http://localhost:8000/api/history/${id}`
        : `/api/history/${id}`;

      const response = await fetch(apiUrl, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Remove from local state
        setHistory(prev => prev.filter(item => item.id !== id));

        // If this was the selected item, clear selection
        if (selectedHistoryId === id) {
          setSelectedHistoryId(null);
          setCurrentMindmapData(null);
          setHasUploadedFile(false);
        }
      }
    } catch (error) {
      console.error('Error deleting history item:', error);
    }
  }, [selectedHistoryId]);

  return (
    <ChatContext.Provider value={{
      messages,
      setMessages,
      sendMessage,
      uploadFile,
      clearChat,
      selectedModel,
      setSelectedModel,
      isLoading,
      hasUploadedFile,
      uploadVersion,
      // History-related
      history,
      selectedHistoryId,
      loadHistory,
      selectHistoryItem,
      deleteHistoryItem,
      currentMindmapData,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
