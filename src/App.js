import React, { useState } from 'react';
import RecordPage from './components/RecordPage';
import LoadingPage from './components/LoadingPage';
import ResultsPage from './components/ResultsPage';

export default function App() {
  const [page, setPage] = useState('record'); // 'record' | 'loading' | 'results'
  const [transcript, setTranscript] = useState('');
  const [soapNote, setSoapNote] = useState(null);

  const handleStop = (rawTranscript) => {
    setTranscript(rawTranscript);
    setPage('loading');
  };

  const handleProcessed = (soap) => {
    setSoapNote(soap);
    setPage('results');
  };

  const handleNewRecording = () => {
    setTranscript('');
    setSoapNote(null);
    setPage('record');
  };

  return (
    <>
      {page === 'record' && (
        <RecordPage onStop={handleStop} />
      )}
      {page === 'loading' && (
        <LoadingPage transcript={transcript} onDone={handleProcessed} />
      )}
      {page === 'results' && (
        <ResultsPage soapNote={soapNote} onNewRecording={handleNewRecording} />
      )}
    </>
  );
}
