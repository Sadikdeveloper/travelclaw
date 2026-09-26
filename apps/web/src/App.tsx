import { createContext, useContext, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from './auth';
import { RequireAuth } from './components/RequireAuth';
import { Shell } from './components/Shell';
import { ChatPage } from './pages/ChatPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

const LiveContext = createContext(0);

export function useLiveRevision() {
  return useContext(LiveContext);
}

export function App() {
  const [revision, setRevision] = useState(0);
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return undefined;
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    const bump = () => setRevision((value) => value + 1);
    socket.on('chat.completed', bump);
    socket.on('task.updated', bump);
    socket.on('heartbeat', bump);
    return () => {
      socket.close();
    };
  }, [userId]);

  return (
    <LiveContext.Provider value={revision}>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route index element={<ChatPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="chat/:sessionId" element={<ChatPage />} />
            <Route path="*" element={<Missing />} />
          </Route>
        </Route>
      </Routes>
    </LiveContext.Provider>
  );
}

function Missing() {
  return (
    <section>
      <p className="kicker">404</p>
      <h1>That page is not on the desk.</h1>
      <p className="lede">The desk only does chat right now. Head back and start one.</p>
    </section>
  );
}
