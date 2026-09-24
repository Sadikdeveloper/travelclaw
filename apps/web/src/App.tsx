import { createContext, useContext, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Shell } from './components/Shell';
import { AgentsPage } from './pages/AgentsPage';
import { ChatPage } from './pages/ChatPage';
import { DeskPage } from './pages/DeskPage';
import { MemoryPage } from './pages/MemoryPage';
import { SkillsPage } from './pages/SkillsPage';
import { TripPage } from './pages/TripPage';
import { TripsPage } from './pages/TripsPage';

const LiveContext = createContext(0);

export function useLiveRevision() {
  return useContext(LiveContext);
}

export function App() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    const bump = () => setRevision((value) => value + 1);
    socket.on('chat.completed', bump);
    socket.on('heartbeat', bump);
    return () => {
      socket.close();
    };
  }, []);

  return (
    <LiveContext.Provider value={revision}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<DeskPage />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="chat/:sessionId" element={<ChatPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="trips/:tripId" element={<TripPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="*" element={<Missing />} />
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
      <p className="lede">
        The gateway still has trips, chat, and memory. Head back to the desk.
      </p>
    </section>
  );
}
