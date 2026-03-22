/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  query, 
  orderBy,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Transaction, OperationType, FirestoreErrorInfo } from './types';
import { getFinancialAdvice, analyzeSmartText } from './services/geminiService';
import { 
  Bell, 
  Grid, 
  PlusCircle, 
  BarChart, 
  History, 
  ShoppingBag, 
  Zap, 
  ArrowDownLeft, 
  Utensils, 
  Car, 
  MoreHorizontal, 
  Calendar, 
  Trash, 
  Home, 
  Sparkles,
  LogOut
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const ProgressBar = ({ label, current, total, percent, color }: { label: string, current: string, total: string, percent: string, color: string }) => (
  <div>
    <div className="flex justify-between text-xs mb-1">
      <span className="font-semibold text-gray-700">{label}</span>
      <span className="font-bold text-blue-600">{current} <span className="text-gray-400 font-normal">/ {total}</span></span>
    </div>
    <div className="w-full bg-[#F3F0E6] rounded-full h-2.5">
      <div className={cn(color, "h-2.5 rounded-full transition-all duration-500")} style={{ width: percent }}></div>
    </div>
  </div>
);

const CategoryIcon = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <div className="flex flex-col items-center gap-2">
    <button 
      onClick={onClick}
      className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center transition-colors shadow-sm",
        active ? 'bg-blue-100 text-blue-600 border border-blue-200' : 'bg-white text-orange-400'
      )}
    >
      {icon}
    </button>
    <span className={cn("text-[10px] font-semibold", active ? 'text-blue-600' : 'text-gray-400')}>{label}</span>
  </div>
);

const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button onClick={onClick} className="flex flex-col items-center gap-1 flex-1">
    <div className={cn("p-2 rounded-xl transition-colors", active ? 'bg-blue-500 text-white shadow-md' : 'text-gray-400 hover:bg-gray-50')}>
      {icon}
    </div>
    <span className={cn("text-[8px] font-bold tracking-wider text-center w-full", active ? 'text-gray-800' : 'text-gray-400')}>
      {label}
    </span>
  </button>
);

const TransactionItem = ({ 
  id, 
  icon, 
  title, 
  category, 
  amount, 
  type, 
  iconBg = "bg-blue-50 text-blue-600", 
  onDelete 
}: { 
  id: string, 
  icon: React.ReactNode, 
  title: string, 
  category: string, 
  amount: string, 
  type: 'income' | 'expense', 
  iconBg?: string, 
  onDelete?: (id: string) => void 
}) => {
  const amountColor = type === 'expense' ? 'text-red-600' : 'text-blue-600';
  return (
    <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", iconBg)}>{icon}</div>
        <div>
          <h5 className="font-bold text-gray-800 text-sm truncate max-w-[120px]">{title}</h5>
          <p className="text-[10px] text-gray-400">{category}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn("font-bold text-sm", amountColor)}>{amount}</span>
        {onDelete && (
          <button 
            onClick={() => onDelete(id)} 
            title="Eliminar registro"
            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
          >
            <Trash size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('resumen');
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [authError, setAuthError] = useState<string | null>(null);

  // Auth initialization
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      if (!currentUser) {
        setLoadingData(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      console.error("Sign In Error:", e);
      if (e.code === 'auth/popup-blocked') {
        setAuthError("El navegador bloqueó la ventana emergente. Intentando método alternativo...");
        try {
            // Fallback to redirect if popup is blocked
            await signInWithRedirect(auth, provider);
        } catch (redirectError: any) {
             console.error("Redirect Sign In Error:", redirectError);
             setAuthError("No se pudo iniciar sesión. Por favor, permite las ventanas emergentes para este sitio.");
        }
      } else if (e.code === 'auth/unauthorized-domain') {
        setAuthError("Dominio no autorizado. Por favor contacta al soporte.");
      } else if (e.code === 'auth/cancelled-popup-request' || e.code === 'auth/popup-closed-by-user') {
        setAuthError("La ventana de inicio de sesión se cerró antes de completar el proceso.");
      } else {
        setAuthError(e.message || "Error al iniciar sesión. Intenta de nuevo.");
      }
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Sign Out Error:", e);
    }
  };

  // Connection test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Data fetching
  useEffect(() => {
    if (!user || !isAuthReady) return;

    setLoadingData(true);
    const txPath = `users/${user.uid}/transactions`;
    const q = query(collection(db, txPath), orderBy('date', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => doc.data() as Transaction);
      setTransactions(txs);
      setLoadingData(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, txPath);
      setLoadingData(false);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const deleteTransaction = async (id: string) => {
    if (!user) return;
    const path = `users/${user.uid}/transactions/${id}`;
    try {
      await deleteDoc(doc(db, path));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, path);
    }
  };

  const formatMoney = (amount: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);

  const getIconComponent = (iconName: string) => {
    switch (iconName) {
      case 'ShoppingBag': return <ShoppingBag size={16} />;
      case 'Utensils': return <Utensils size={16} />;
      case 'Car': return <Car size={16} />;
      case 'Home': return <Home size={16} />;
      case 'ArrowDownLeft': return <ArrowDownLeft size={16} />;
      case 'Zap': return <Zap size={16} />;
      case 'Sparkles': return <Sparkles size={16} />;
      default: return <MoreHorizontal size={16} />;
    }
  };

  // --- Views ---

  const Header = () => (
    <div className="flex justify-between items-center mb-6 px-2 pt-2 w-full shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 shrink-0 rounded-full bg-orange-200 overflow-hidden flex items-center justify-center text-orange-600">
          <img 
            src={user?.photoURL || "https://images.unsplash.com/photo-1543599538-a6c4f6cc5c05?q=80&w=1376&auto=format&fit=crop"} 
            alt="Perfil" 
            className="w-full h-full object-cover" 
            referrerPolicy="no-referrer"
          />
        </div>
        <h1 className="font-bold text-blue-900 text-lg tracking-tight italic whitespace-nowrap">Finanzas del Hogar</h1>
      </div>
      <div className="flex items-center gap-2">
        <button className="text-blue-900 shrink-0 bg-blue-100/50 p-2 rounded-full hover:bg-blue-200 transition-colors">
          <Bell size={20} />
        </button>
        <button 
          onClick={handleSignOut}
          className="text-red-600 shrink-0 bg-red-100/50 p-2 rounded-full hover:bg-red-200 transition-colors"
          title="Cerrar sesión"
        >
          <LogOut size={20} />
        </button>
      </div>
    </div>
  );

  const ViewResumen = () => {
    const [aiAdvice, setAiAdvice] = useState<string | null>(null);
    const [isFetchingAdvice, setIsFetchingAdvice] = useState(false);

    const totalIncomes = useMemo(() => transactions.filter(t => t.type === 'income').reduce((acc, curr) => acc + curr.amount, 0), [transactions]);
    const totalExpenses = useMemo(() => transactions.filter(t => t.type === 'expense').reduce((acc, curr) => acc + curr.amount, 0), [transactions]);
    const currentBalance = totalIncomes - totalExpenses;

    const last5Days = useMemo(() => {
      const days = Array.from({ length: 5 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (4 - i));
        return { date: d.toLocaleDateString(), amount: 0, isToday: i === 4 };
      });
      transactions.forEach(tx => {
        if (tx.type === 'expense') {
          const txDate = new Date(tx.date).toLocaleDateString();
          const dayObj = days.find(d => d.date === txDate);
          if (dayObj) dayObj.amount += tx.amount;
        }
      });
      return days;
    }, [transactions]);

    const maxDailyExpense = Math.max(...last5Days.map(d => d.amount), 1);
    const todayData = last5Days[4];
    const todayTxCount = transactions.filter(t => t.type === 'expense' && new Date(t.date).toLocaleDateString() === todayData.date).length;

    const fetchAiAdvice = async () => {
      setIsFetchingAdvice(true);
      try {
        const advice = await getFinancialAdvice(transactions);
        setAiAdvice(advice || "No pude generar un consejo.");
      } catch (e) {
        setAiAdvice("Lo siento, no pude conectar con tu asesor en este momento.");
      } finally {
        setIsFetchingAdvice(false);
      }
    };

    return (
      <div className="flex flex-col gap-4 pb-24 w-full min-h-full animate-fade-in">
        <Header />
        
        <div className="bg-gradient-to-br from-white to-blue-50 rounded-[2rem] p-6 shadow-sm border border-blue-50 relative overflow-hidden">
          <div className="absolute top-0 right-0 opacity-10 transform translate-x-1/4 -translate-y-1/4">
            <Sparkles className="w-24 h-24 text-blue-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2 flex items-center gap-2">
            Hola <span className="text-xl">✨</span>
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed min-h-[40px]">
            {aiAdvice ? aiAdvice : `Tu pulso financiero está bajo control. Tienes ${transactions.length} movimientos en total registrados en tu historial.`}
          </p>
          <button 
            onClick={fetchAiAdvice} 
            disabled={isFetchingAdvice}
            className="mt-4 text-xs font-bold text-blue-600 bg-blue-100/50 hover:bg-blue-100 px-4 py-2.5 rounded-full transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
          >
            {isFetchingAdvice ? "Generando consejo..." : "✨ Pedir consejo financiero"}
          </button>
        </div>

        <div className="bg-blue-500 text-white rounded-[2rem] p-6 shadow-md relative overflow-hidden">
          <div className="absolute top-0 right-0 opacity-10 transform translate-x-1/4 -translate-y-1/4">
            <div className="w-[150px] h-[150px] bg-white rounded-full opacity-20"></div>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-1 opacity-90">Saldo Total</p>
          <h3 className="text-4xl font-bold mb-2 tracking-tight">{formatMoney(currentBalance)}</h3>
          <p className="text-xs text-blue-100 flex items-center gap-1">
            <Zap size={12} />
            Actualizado y guardado
          </p>
        </div>

        <button onClick={() => setActiveTab('gastos')} className="bg-[#cc2229] hover:bg-red-700 text-white rounded-2xl py-4 flex items-center justify-center gap-2 font-bold shadow-md transition-colors">
          <div className="bg-white text-red-600 rounded-full w-5 h-5 flex items-center justify-center font-bold text-lg leading-none">+</div>
          AÑADIR GASTO / INGRESO
        </button>

        <div className="bg-white rounded-[2rem] p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h4 className="font-bold text-gray-800 text-sm">Gastos Recientes</h4>
            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md uppercase">Últ. 5 Días</span>
          </div>
          
          <div className="flex justify-between items-end h-16 mb-4 px-2">
            {last5Days.map((day, idx) => {
              const heightPct = (day.amount / maxDailyExpense) * 100;
              const bgColor = day.isToday ? 'bg-red-500' : (heightPct > 0 ? 'bg-blue-500' : 'bg-gray-200');
              return (
                <div key={idx} className={cn("w-2 rounded-full transition-all duration-500", bgColor)} style={{ height: `${Math.max(heightPct, 10)}%` }}></div>
              );
            })}
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-gray-800">{formatMoney(todayData.amount)}</p>
            <p className="text-xs text-gray-400">Gastado en {todayTxCount} transacciones hoy</p>
          </div>
        </div>

        <div className="mt-2">
          <div className="flex justify-between items-end mb-4 px-1">
            <div>
              <h3 className="font-bold text-gray-800">Historial Reciente</h3>
              <p className="text-xs text-gray-500">Tus últimos movimientos</p>
            </div>
            <button onClick={() => setActiveTab('historial')} className="text-blue-600 text-xs font-semibold">Ver todo</button>
          </div>
          
          <div className="bg-white rounded-[2rem] p-2 flex flex-col gap-2 shadow-sm">
            {transactions.slice(0, 3).map(tx => (
              <TransactionItem 
                key={tx.id} id={tx.id}
                icon={getIconComponent(tx.icon)} title={tx.title} 
                category={`${tx.category} • ${new Date(tx.date).toLocaleDateString()}`} 
                amount={`${tx.type === 'expense' ? '-' : '+'}${formatMoney(tx.amount)}`} 
                type={tx.type} iconBg={tx.type === 'expense' ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}
              />
            ))}
            {transactions.length === 0 && <p className="text-center text-sm text-gray-400 py-4">No hay transacciones aún.</p>}
          </div>
        </div>
      </div>
    );
  };

  const ViewGraficos = () => {
    const [graficosPeriod, setGraficosPeriod] = useState('Mes');
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const filteredTxs = transactions.filter(tx => {
      const txDate = new Date(tx.date);
      if (graficosPeriod === 'Día') return txDate.toLocaleDateString() === now.toLocaleDateString();
      if (graficosPeriod === 'Mes') return txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear;
      return txDate.getFullYear() === currentYear;
    });

    const gastosTxs = filteredTxs.filter(t => t.type === 'expense');
    const fijos = gastosTxs.filter(t => ['Servicios', 'Súper', 'Arriendo', 'Bencina'].includes(t.category)).reduce((acc, curr) => acc + curr.amount, 0);
    const ocio = gastosTxs.filter(t => ['Comida', 'Viaje', 'Otros'].includes(t.category)).reduce((acc, curr) => acc + curr.amount, 0);
    const totalDona = fijos + ocio;
    
    const fijosPct = totalDona === 0 ? 0 : (fijos / totalDona) * 100;
    const conicGradient = `conic-gradient(#1D4ED8 0% ${fijosPct}%, #DC2626 ${fijosPct}% 100%)`;

    const budget = { 'Alquiler & Hogar': 1500, 'Alimentación': 600, 'Servicios & Apps': 450 };
    const spent = {
      'Alquiler & Hogar': gastosTxs.filter(t => t.category === 'Arriendo' || t.title.toLowerCase().includes('alquiler') || t.title.toLowerCase().includes('hogar')).reduce((a,c)=>a+c.amount, 0),
      'Alimentación': gastosTxs.filter(t => ['Súper', 'Comida'].includes(t.category)).reduce((a,c)=>a+c.amount, 0),
      'Servicios & Apps': gastosTxs.filter(t => ['Servicios', 'Bencina'].includes(t.category) || (!t.title.toLowerCase().includes('alquiler') && t.category === 'Otros')).reduce((a,c)=>a+c.amount, 0)
    };

    const last6Months = Array.from({length: 6}, (_, i) => {
      const d = new Date(currentYear, currentMonth - (5 - i), 1);
      return { month: d.getMonth(), year: d.getFullYear(), label: d.toLocaleString('es-ES', { month: 'short' }).toUpperCase(), expenses: 0 };
    });
    transactions.filter(t => t.type === 'expense').forEach(tx => {
      const txDate = new Date(tx.date);
      const mObj = last6Months.find(m => m.month === txDate.getMonth() && m.year === txDate.getFullYear());
      if (mObj) mObj.expenses += tx.amount;
    });
    const maxMonthExp = Math.max(...last6Months.map(m => m.expenses), 1);

    let maxTx = transactions.filter(t => t.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
    let maxDateStr = 'N/A';
    if(maxTx) {
      const d = new Date(maxTx.date);
      maxDateStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
      maxDateStr = maxDateStr.charAt(0).toUpperCase() + maxDateStr.slice(1);
    }

    return (
      <div className="flex flex-col gap-4 pb-24 w-full min-h-full animate-fade-in">
        <Header />
        
        <div className="flex bg-[#F3F0E6] rounded-full p-1 mx-auto w-3/4 max-w-[250px] mb-2">
          {['Día', 'Mes', 'Año'].map(period => (
            <button key={period} onClick={() => setGraficosPeriod(period)} 
              className={cn(
                "flex-1 py-1.5 text-xs font-semibold rounded-full transition-colors",
                graficosPeriod === period ? 'text-white bg-blue-500 shadow-md' : 'text-gray-500'
              )}>
              {period}
            </button>
          ))}
        </div>

        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-gray-800">Análisis de Gastos</h2>
          <p className="text-xs text-gray-500 mt-1">Mes actual vs Mes anterior</p>
        </div>

        <div className="bg-white rounded-[2rem] p-6 shadow-sm flex flex-col items-center">
          <h4 className="font-bold text-sm text-gray-800 mb-1">Distribución</h4>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-6">Por Categoría</p>
          
          <div className="relative w-40 h-40 rounded-full mb-6 transition-all duration-500" style={{ background: totalDona > 0 ? conicGradient : '#e5e7eb' }}>
            <div className="absolute inset-0 m-auto w-[110px] h-[110px] bg-white rounded-full flex flex-col items-center justify-center shadow-inner">
              <span className="text-xl font-bold text-blue-600">{formatMoney(totalDona)}</span>
              <span className="text-[10px] text-gray-400 uppercase">Total</span>
            </div>
          </div>

          <div className="flex gap-6 text-xs font-medium text-gray-600 w-full justify-center">
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-600"></span> Fijos</div>
            <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-600"></span> Ocio</div>
          </div>
        </div>

        <div className="bg-white rounded-[2rem] p-6 shadow-sm">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h4 className="font-bold text-sm text-gray-800 mb-1">Tendencia Mensual</h4>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Gastos vs Ahorro</p>
            </div>
            <span className="bg-red-200 text-red-600 text-[10px] font-bold px-2 py-1 rounded-full">+12% vs prev</span>
          </div>
          
          <div className="flex items-end justify-between h-32 px-1 gap-2 mt-4">
            {last6Months.map((m, idx) => {
              const hPct = (m.expenses / maxMonthExp) * 100;
              const isCurrent = idx === 5;
              let barColor = 'bg-[#F3F0E6]'; 
              if (isCurrent) barColor = 'bg-blue-600';
              else if (idx === 4) barColor = 'bg-red-200';
              else if (idx === 3) barColor = 'bg-blue-200';

              return (
                <div key={idx} className="w-full flex justify-center group relative">
                  {isCurrent && m.expenses > 0 && (
                    <div className="absolute -top-6 bg-gray-800 text-white text-[9px] px-2 py-1 rounded whitespace-nowrap z-10 shadow-md">
                      {formatMoney(m.expenses)}
                    </div>
                  )}
                  <div className={cn("w-full rounded-t-md transition-all duration-500", barColor)} style={{ height: `${Math.max(hPct, 10)}%` }}></div>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 font-medium mt-2 px-1">
            {last6Months.map((m, idx) => <span key={idx} className={idx === 5 ? 'text-gray-800 font-bold' : ''}>{m.label.substring(0,3)}</span>)}
          </div>
        </div>

        <div className="bg-white rounded-[2rem] p-6 shadow-sm relative overflow-hidden">
          <h4 className="font-bold text-lg text-gray-800 mb-2 leading-tight">Comparativa de<br/>Presupuesto</h4>
          <p className="text-xs text-gray-500 mb-4 max-w-[90%]">Has optimizado un 15% tus gastos en alimentación respecto al trimestre anterior.</p>
          
          <button className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold px-5 py-2.5 rounded-full mb-6 shadow-sm transition-colors">
            Ver Reporte PDF
          </button>
          
          <div className="space-y-5">
            <ProgressBar label="Alquiler & Hogar" current={formatMoney(spent['Alquiler & Hogar'])} total={formatMoney(budget['Alquiler & Hogar'])} percent={`${Math.min((spent['Alquiler & Hogar']/budget['Alquiler & Hogar'])*100, 100)}%`} color="bg-blue-600" />
            <ProgressBar label="Alimentación" current={formatMoney(spent['Alimentación'])} total={formatMoney(budget['Alimentación'])} percent={`${Math.min((spent['Alimentación']/budget['Alimentación'])*100, 100)}%`} color="bg-red-600" />
            <ProgressBar label="Servicios & Apps" current={formatMoney(spent['Servicios & Apps'])} total={formatMoney(budget['Servicios & Apps'])} percent={`${Math.min((spent['Servicios & Apps']/budget['Servicios & Apps'])*100, 100)}%`} color="bg-blue-400" />
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1 bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-[9px] text-gray-400 uppercase font-semibold mb-1">Máximo Gasto Diario</p>
            <p className="text-sm font-bold text-red-600">{maxDateStr}</p>
            <p className="text-[10px] text-gray-500 mt-1 truncate">
              {maxTx ? `${maxTx.title} • ${formatMoney(maxTx.amount)}` : 'Sin gastos registrados'}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm w-1/3 flex flex-col justify-center items-center text-center">
            <p className="text-[9px] text-gray-400 uppercase font-semibold mb-1">Ahorro</p>
            <p className="text-xl font-bold text-blue-600">{formatMoney(Math.max(transactions.filter(t => t.type === 'income').reduce((a,c)=>a+c.amount,0) - transactions.filter(t => t.type === 'expense').reduce((a,c)=>a+c.amount,0), 0))}</p>
            <p className="text-[9px] text-gray-400 mt-1">Total acumulado</p>
          </div>
        </div>
      </div>
    );
  };

  const ViewGastos = () => {
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [category, setCategory] = useState('Súper');
    const [type, setType] = useState<'income' | 'expense'>('expense');
    const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
    const [smartText, setSmartText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleSmartAnalyze = async () => {
      if (!smartText.trim()) return;
      setIsAnalyzing(true);
      try {
        const result = await analyzeSmartText(smartText);
        if (result.amount) setAmount(result.amount.toString());
        if (result.category) {
          if (result.category === 'Ingresos') setType('income');
          else { setType('expense'); setCategory(result.category); }
        }
        if (result.note) setNote(result.note);
        if (result.date) setTxDate(result.date.split('T')[0]);
        if (result.type) setType(result.type as 'income' | 'expense');
        setSmartText('');
      } catch (e) {
        console.error("Error analizando con IA:", e);
      } finally {
        setIsAnalyzing(false);
      }
    };

    const handleSave = async () => {
      if (!amount || isNaN(Number(amount)) || parseFloat(amount) <= 0 || !user) return;

      const selectedDate = new Date(txDate + 'T12:00:00').toISOString();
      const id = Date.now().toString();
      const newTx: Transaction = {
        id,
        title: note || category,
        category: type === 'income' ? 'Ingresos' : category,
        amount: parseFloat(amount),
        type: type,
        date: selectedDate,
        icon: type === 'income' ? 'ArrowDownLeft' : (category === 'Súper' ? 'ShoppingBag' : category === 'Comida' ? 'Utensils' : category === 'Bencina' ? 'Car' : category === 'Arriendo' ? 'Home' : 'MoreHorizontal'),
        uid: user.uid
      };

      const path = `users/${user.uid}/transactions/${id}`;
      try {
        await setDoc(doc(db, path), newTx);
        setActiveTab('resumen');
      } catch(e) { 
        handleFirestoreError(e, OperationType.WRITE, path);
      }
    };

    return (
      <div className="flex flex-col gap-4 pb-24 w-full min-h-full animate-fade-in">
        <Header />
        
        <div className="mb-2 flex justify-between items-end">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Registrar<br/>{type === 'expense' ? 'Gasto' : 'Ingreso'}</h2>
            <p className="text-sm text-gray-500 mt-1">Cuidando la economía de tu hogar.</p>
          </div>
          <div className="flex bg-gray-100 rounded-full p-1">
            <button onClick={() => setType('expense')} className={cn("px-3 py-1 text-xs font-semibold rounded-full transition-colors", type === 'expense' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-500')}>Gasto</button>
            <button onClick={() => setType('income')} className={cn("px-3 py-1 text-xs font-semibold rounded-full transition-colors", type === 'income' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500')}>Ingreso</button>
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-[2rem] p-5 shadow-sm mb-2 border border-blue-100">
          <label className="text-[10px] text-blue-800 uppercase tracking-wider font-bold block mb-2 flex items-center gap-1">
            <Sparkles className="w-3 h-3"/> Ingreso Rápido con IA
          </label>
          <textarea
            value={smartText}
            onChange={(e) => setSmartText(e.target.value)}
            placeholder="Ej: Ayer gasté $15000 en el súper..."
            className="w-full bg-white rounded-xl p-3 text-sm text-gray-800 outline-none border border-blue-100 mb-3 resize-none h-16"
          ></textarea>
          <button
            onClick={handleSmartAnalyze}
            disabled={isAnalyzing || !smartText.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl py-2.5 flex items-center justify-center gap-2 font-bold shadow-sm transition-colors text-xs"
          >
            {isAnalyzing ? "Analizando tu mensaje..." : "✨ Extraer y Autocompletar"}
          </button>
        </div>

        <div className="bg-white rounded-[2rem] p-6 shadow-sm mb-2">
          <label className="text-xs text-gray-400 uppercase tracking-wider font-semibold block mb-2">Monto del {type === 'expense' ? 'gasto' : 'ingreso'}</label>
          <div className="flex items-center text-5xl font-bold text-gray-300">
            <span className={cn("mr-2", type === 'expense' ? 'text-red-500' : 'text-blue-500')}>$</span>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full outline-none bg-transparent text-gray-800 placeholder-gray-300" />
          </div>
        </div>

        {type === 'expense' && (
          <div className="mb-4 px-2">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold block mb-3">Categoría</label>
            <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-2">
              {['Súper', 'Comida', 'Bencina', 'Arriendo', 'Otros'].map(cat => {
                const icon = cat === 'Súper' ? <ShoppingBag size={16} /> : cat === 'Comida' ? <Utensils size={16} /> : cat === 'Bencina' ? <Car size={16} /> : cat === 'Arriendo' ? <Home size={16} /> : <MoreHorizontal size={16} />;
                return (
                  <CategoryIcon key={cat} icon={icon} label={cat} active={category === cat} onClick={() => setCategory(cat)} />
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-4 px-2 flex-grow">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold block mb-2">Fecha</label>
            <div className="bg-white rounded-xl p-3 flex items-center shadow-sm border border-gray-100">
              <Calendar size={16} />
              <input 
                type="date" 
                value={txDate} 
                onChange={(e) => setTxDate(e.target.value)} 
                className="ml-3 text-sm text-gray-800 font-medium w-full outline-none bg-transparent cursor-pointer" 
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold block mb-2">Nota</label>
            <div className="bg-white rounded-xl p-3 flex items-center shadow-sm border border-gray-100 text-gray-400">
              <Zap size={16} />
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'expense' ? "Ej. Compras del mes" : "Ej. Sueldo"} className="ml-3 text-sm w-full outline-none bg-transparent text-gray-800" />
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6 px-2">
          <button onClick={handleSave} className={cn("w-full text-white rounded-2xl py-4 flex items-center justify-center gap-2 font-bold shadow-md transition-colors", type === 'expense' ? 'bg-[#cc2229] hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700')}>
            <PlusCircle size={18} />
            Guardar {type === 'expense' ? 'Gasto' : 'Ingreso'}
          </button>
        </div>
      </div>
    );
  };

  const ViewHistorial = () => {
    const [visibleCount, setVisibleCount] = useState(10);
    const [historialFilter, setHistorialFilter] = useState('Todos');

    const filteredList = transactions.filter(tx => {
      if (historialFilter === 'Todos') return true;
      if (historialFilter === 'Alimentación') return ['Súper', 'Comida'].includes(tx.category);
      if (historialFilter === 'Servicios') return ['Servicios', 'Arriendo', 'Bencina'].includes(tx.category);
      return true;
    });

    const visibleList = filteredList.slice(0, visibleCount);

    const groupedTransactions = visibleList.reduce((acc: Record<string, Transaction[]>, tx) => {
      const dateStr = new Date(tx.date).toLocaleDateString();
      if (!acc[dateStr]) acc[dateStr] = [];
      acc[dateStr].push(tx);
      return acc;
    }, {});

    return (
      <div className="flex flex-col gap-4 pb-24 w-full min-h-full animate-fade-in">
        <Header />
        
        <div className="mb-4">
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mb-1">Registros</p>
          <h2 className="text-3xl font-bold text-gray-800 leading-tight">Historial de<br/>Transacciones</h2>
        </div>

        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-2">
          {['Todos', 'Alimentación', 'Servicios'].map(filter => (
            <button key={filter} onClick={() => { setHistorialFilter(filter); setVisibleCount(10); }} 
              className={cn(
                "text-xs font-semibold px-4 py-2 rounded-full whitespace-nowrap shadow-sm transition-colors",
                historialFilter === filter ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-100'
              )}>
              {filter}
            </button>
          ))}
        </div>

        <div className="mt-2 space-y-6">
          {Object.entries(groupedTransactions).map(([date, txs]) => (
            <div key={date}>
              <h3 className="text-xs font-bold text-gray-800 mb-3 px-1">{date === new Date().toLocaleDateString() ? 'Hoy' : date}</h3>
              <div className="bg-white rounded-[2rem] p-2 flex flex-col gap-2 shadow-sm">
                {txs.map(tx => (
                  <TransactionItem 
                    key={tx.id} id={tx.id}
                    icon={getIconComponent(tx.icon)} iconBg={tx.type === 'expense' ? "bg-red-50 text-red-500" : "bg-blue-50 text-blue-600"}
                    title={tx.title} category={`${tx.category} • ${new Date(tx.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
                    amount={`${tx.type === 'expense' ? '-' : '+'}${formatMoney(tx.amount)}`} type={tx.type} 
                    onDelete={deleteTransaction}
                  />
                ))}
              </div>
            </div>
          ))}
          {Object.keys(groupedTransactions).length === 0 && (
            <p className="text-center text-gray-400 text-sm py-10">No hay registros para mostrar.</p>
          )}
        </div>

        {visibleCount < filteredList.length && (
          <div className="mt-4 flex justify-center">
            <button onClick={() => setVisibleCount(prev => prev + 10)} className="text-blue-600 text-xs font-semibold border border-blue-100 bg-white rounded-full px-6 py-3 shadow-sm hover:bg-blue-50 transition-colors">
              Cargar registros anteriores
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loadingData && !isAuthReady) {
    return (
      <div className="w-[390px] h-[844px] bg-[#F8F5EE] flex flex-col justify-center items-center shadow-2xl rounded-[3rem] border-[8px] border-black p-8 text-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 font-medium">Sincronizando datos...</p>
      </div>
    );
  }

  if (isAuthReady && !user) {
    return (
      <div className="w-[390px] h-[844px] bg-[#F8F5EE] flex flex-col justify-center items-center shadow-2xl rounded-[3rem] border-[8px] border-black p-8 text-center animate-fade-in">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6">
          <Sparkles className="w-10 h-10 text-blue-600" />
        </div>
        <h1 className="text-2xl font-bold text-blue-900 mb-2">Finanzas del Hogar</h1>
        <p className="text-gray-600 mb-8 text-sm">Gestiona tus gastos e ingresos con la ayuda de IA.</p>
        
        {authError && (
          <div className="mb-6 w-full p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm text-left">
            {authError}
          </div>
        )}

        <button 
          onClick={handleSignIn}
          className="w-full bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-6 rounded-2xl shadow-sm border border-gray-200 transition-all flex items-center justify-center gap-3"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
          Continuar con Google
        </button>
      </div>
    );
  }

  return (
    <div className="w-[390px] h-[844px] bg-[#F8F5EE] relative overflow-hidden flex flex-col shadow-2xl rounded-[3rem] border-[8px] border-black my-4 shrink-0">
      <div className="flex-1 overflow-y-auto hide-scrollbar p-6">
        {activeTab === 'resumen' && <ViewResumen />}
        {activeTab === 'graficos' && <ViewGraficos />}
        {activeTab === 'gastos' && <ViewGastos />}
        {activeTab === 'historial' && <ViewHistorial />}
      </div>
      <div className="absolute bottom-0 w-full bg-white rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)] px-6 py-4 pb-8 flex justify-between items-center z-50">
        <NavItem icon={<Grid size={24} />} label="RESUMEN" active={activeTab === 'resumen'} onClick={() => setActiveTab('resumen')} />
        <NavItem icon={<PlusCircle size={24} />} label="GASTOS" active={activeTab === 'gastos'} onClick={() => setActiveTab('gastos')} />
        <NavItem icon={<BarChart size={24} />} label="GRÁFICOS" active={activeTab === 'graficos'} onClick={() => setActiveTab('graficos')} />
        <NavItem icon={<History size={24} />} label="HISTORIAL" active={activeTab === 'historial'} onClick={() => setActiveTab('historial')} />
      </div>
    </div>
  );
}
