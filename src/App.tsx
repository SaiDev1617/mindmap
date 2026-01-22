import { useState } from 'react';
import ChatPanel from './components/ChatPanel';
import MarkmapPanel from './components/MarkmapPanel';
import LandingPanel from './components/LandingPanel';
import { ChatProvider, useChat } from './contexts/ChatContext';
import './App.css';

function AppContent() {
  const [isMarkmapMaximized, setIsMarkmapMaximized] = useState(false);
  const [isMarkmapMinimized, setIsMarkmapMinimized] = useState(false);
  const { hasUploadedFile } = useChat();

  return (
    <div className={`app-container ${isMarkmapMaximized ? 'markmap-fullscreen' : ''}`}>
      {!isMarkmapMaximized && (
        <div className="left-panel">
          <ChatPanel />
        </div>
      )}
      <div className={`right-panel ${isMarkmapMinimized ? 'minimized' : ''}`}>
        {hasUploadedFile ? (
          <MarkmapPanel 
            isMaximized={isMarkmapMaximized}
            onToggleMaximize={() => setIsMarkmapMaximized(!isMarkmapMaximized)}
            onMinimize={() => setIsMarkmapMinimized(!isMarkmapMinimized)}
            isMinimized={isMarkmapMinimized}
          />
        ) : (
          <LandingPanel />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
}

export default App;
