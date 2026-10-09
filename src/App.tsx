import { ScanScreen } from './ui/ScanScreen';

export default function App() {
  return (
    <div className="app">
      <header className="topbar">YGO Scanner</header>
      <main className="screen">
        <ScanScreen />
      </main>
    </div>
  );
}
