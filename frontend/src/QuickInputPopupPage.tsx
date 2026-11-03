import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import QuickInputModal from './components/QuickInputModal';

export const QuickInputPopupPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const modeParam = searchParams.get('mode');
  const initialMode: 'user' | 'banned' = modeParam === 'user' ? 'user' : 'banned';

  useEffect(() => {
    document.title = "BABA TTS - Quick Input";
  }, []);

  return (
    <div className="w-screen h-screen bg-gray-950 flex items-center justify-center overflow-hidden">
      <QuickInputModal
        isOpen={true}
        initialMode={initialMode}
        onClose={() => window.close()}
        onSent={(_text, _mode) => {
          // Window closes automatically inside component onSent
        }}
        isStandalone={true}
      />
    </div>
  );
};

export default QuickInputPopupPage;
