import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, FileCheck, Sparkles, GitBranch, Eye, ChevronRight, AlertCircle, Database } from 'lucide-react';
import { useChat } from '../contexts/ChatContext';

interface LandingPanelProps {
  onUploadComplete?: () => void;
}

export default function LandingPanel({ onUploadComplete }: LandingPanelProps) {
  const { uploadFile, isLoading } = useChat();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): boolean => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExtensions = ['.pdf', '.docx'];
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      alert('Please upload only PDF or DOCX files.');
      return false;
    }

    // Check file size (max 50MB)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('File size must be under 50MB.');
      return false;
    }

    return true;
  };

  const handleFileUpload = async (file: File) => {
    if (!validateFile(file)) return;

    setSelectedFileName(file.name);
    setUploadingFile(true);
    setUploadProgress(0);

    // Simulate progress animation
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    await uploadFile(file);

    clearInterval(progressInterval);
    setUploadProgress(100);

    setTimeout(() => {
      setUploadingFile(false);
      setUploadProgress(0);
      setSelectedFileName(null);
      onUploadComplete?.();
    }, 500);
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await handleFileUpload(e.target.files[0]);
    e.target.value = '';
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const pipelineSteps = [
    {
      icon: FileCheck,
      title: 'Parse',
      description: 'Docling/LlamaParse',
      color: '#8B5CF6',
      bgColor: 'rgba(139, 92, 246, 0.1)',
    },
    {
      icon: Database,
      title: 'Build RAG',
      description: 'LlamaIndex',
      color: '#06B6D4',
      bgColor: 'rgba(6, 182, 212, 0.1)',
    },
    {
      icon: Sparkles,
      title: 'LLM',
      description: 'Key concepts',
      color: '#EC4899',
      bgColor: 'rgba(236, 72, 153, 0.1)',
    },
    {
      icon: GitBranch,
      title: 'Build Map',
      description: 'Structure',
      color: '#10B981',
      bgColor: 'rgba(16, 185, 129, 0.1)',
    },
    {
      icon: Eye,
      title: 'Visualize',
      description: 'Mind map',
      color: '#F59E0B',
      bgColor: 'rgba(245, 158, 11, 0.1)',
    },
  ];

  return (
    <div className="landing-panel">
      {/* Decorative background pattern */}
      <div className="landing-bg-pattern">
        <div className="landing-bg-gradient" />
        <div className="landing-bg-mesh" />
      </div>

      <div className="landing-content">
        {/* Hero Section */}
        <div className="landing-hero">
          <div className="landing-badge">
            <Sparkles size={14} />
            <span>AI-Powered Document Intelligence</span>
          </div>
          <h1 className="landing-title">
            Transform Documents into
            <span className="gradient-text"> Interactive Mind Maps</span>
          </h1>
          <p className="landing-subtitle">
            Turn complex documents into clear, interactive mind maps
          </p>
        </div>

        {/* Upload Zone */}
        <div
          className={`landing-upload-zone ${isDragging ? 'dragging' : ''} ${uploadingFile ? 'uploading' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploadingFile && !isLoading && fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleInputChange}
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
          />

          {uploadingFile ? (
            <div className="upload-progress-content">
              <div className="upload-progress-icon">
                <FileText size={32} />
                <div className="upload-spinner" />
              </div>
              <div className="upload-progress-info">
                <span className="upload-filename">{selectedFileName}</span>
                <div className="upload-progress-bar">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="upload-progress-text">Processing document...</span>
              </div>
            </div>
          ) : (
            <>
              <div className="upload-icon-container">
                <div className="upload-icon-ring" />
                <div className="upload-icon-ring delay-1" />
                <div className="upload-icon-ring delay-2" />
                <div className="upload-icon-bg">
                  <Upload size={36} strokeWidth={2} />
                </div>
              </div>
              <div className="upload-text">
                <h3>Drop your document here</h3>
                <p>or <span className="upload-browse">browse</span> to upload</p>
              </div>
              <div className="upload-formats">
                <div className="format-badge pdf">
                  <FileText size={14} />
                  <span>PDF</span>
                </div>
                <div className="format-badge docx">
                  <FileText size={14} />
                  <span>DOCX</span>
                </div>
              </div>
              <div className="upload-limits">
                <AlertCircle size={12} />
                <span>Maximum file size: 50MB</span>
              </div>
            </>
          )}
        </div>

        {/* Pipeline Visualization */}
        <div className="landing-pipeline">
          <h4 className="pipeline-title">How it works</h4>
          <div className="pipeline-steps">
            {pipelineSteps.map((step, index) => (
              <div key={index} className="pipeline-step">
                <div
                  className="pipeline-step-icon"
                  style={{
                    backgroundColor: step.bgColor,
                    color: step.color,
                  }}
                >
                  <step.icon size={24} strokeWidth={2} />
                </div>
                <div className="pipeline-step-content">
                  <span className="pipeline-step-title">{step.title}</span>
                  <span className="pipeline-step-desc">{step.description}</span>
                </div>
                {index < pipelineSteps.length - 1 && (
                  <div className="pipeline-arrow">
                    <ChevronRight size={24} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
