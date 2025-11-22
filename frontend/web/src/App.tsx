import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DebtData {
  id: string;
  name: string;
  amount: string;
  interestRate: number;
  term: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  publicValue1: number;
  publicValue2: number;
}

interface DebtStats {
  totalDebt: number;
  averageInterest: number;
  highestDebt: number;
  activeLoans: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDebt, setCreatingDebt] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDebtData, setNewDebtData] = useState({ 
    name: "", 
    amount: "", 
    interestRate: 5, 
    term: 12,
    description: "" 
  });
  const [selectedDebt, setSelectedDebt] = useState<DebtData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<DebtStats>({
    totalDebt: 0,
    averageInterest: 0,
    highestDebt: 0,
    activeLoans: 0
  });
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const calculateStats = (debtsList: DebtData[]) => {
    const verifiedDebts = debtsList.filter(d => d.isVerified);
    const total = verifiedDebts.reduce((sum, debt) => sum + (debt.decryptedValue || 0), 0);
    const avgInterest = verifiedDebts.reduce((sum, debt) => sum + debt.interestRate, 0) / (verifiedDebts.length || 1);
    const highest = Math.max(...verifiedDebts.map(d => d.decryptedValue || 0), 0);
    
    setStats({
      totalDebt: total,
      averageInterest: avgInterest,
      highestDebt: highest,
      activeLoans: verifiedDebts.length
    });
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const debtsList: DebtData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          debtsList.push({
            id: businessId,
            name: businessData.name,
            amount: businessId,
            interestRate: Number(businessData.publicValue1) || 0,
            term: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setDebts(debtsList);
      calculateStats(debtsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createDebt = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDebt(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted debt record..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newDebtData.amount) || 0;
      const businessId = `debt-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDebtData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newDebtData.interestRate,
        newDebtData.term,
        newDebtData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Debt record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDebtData({ name: "", amount: "", interestRate: 5, term: 12, description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDebt(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available and ready!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateRepaymentPlan = (debt: DebtData, decryptedAmount: number | null) => {
    const amount = debt.isVerified ? (debt.decryptedValue || 0) : (decryptedAmount || 0);
    const monthlyRate = debt.interestRate / 100 / 12;
    const months = debt.term;
    
    const monthlyPayment = monthlyRate === 0 ? amount / months : 
      (amount * monthlyRate * Math.pow(1 + monthlyRate, months)) / 
      (Math.pow(1 + monthlyRate, months) - 1);
    
    return {
      monthlyPayment: Math.round(monthlyPayment * 100) / 100,
      totalPayment: Math.round(monthlyPayment * months * 100) / 100,
      totalInterest: Math.round((monthlyPayment * months - amount) * 100) / 100
    };
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel copper-panel">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Encrypted Debt</h3>
            <div className="stat-value">${stats.totalDebt.toLocaleString()}</div>
            <div className="stat-trend">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-panel bronze-panel">
          <div className="stat-icon">📈</div>
          <div className="stat-content">
            <h3>Average Interest</h3>
            <div className="stat-value">{stats.averageInterest.toFixed(1)}%</div>
            <div className="stat-trend">Across {stats.activeLoans} loans</div>
          </div>
        </div>
        
        <div className="stat-panel gold-panel">
          <div className="stat-icon">🏆</div>
          <div className="stat-content">
            <h3>Highest Debt</h3>
            <div className="stat-value">${stats.highestDebt.toLocaleString()}</div>
            <div className="stat-trend">Single largest loan</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    return (
      <div className="faq-section">
        <h3>FHE Debt Management FAQ</h3>
        <div className="faq-list">
          <div className="faq-item">
            <h4>How is my debt data protected?</h4>
            <p>All debt amounts are encrypted using Fully Homomorphic Encryption (FHE) before being stored on-chain. Even the network nodes cannot see your actual debt values.</p>
          </div>
          <div className="faq-item">
            <h4>What can be calculated while encrypted?</h4>
            <p>Interest calculations, repayment plans, and debt summaries are computed homomorphically without decrypting your data, preserving your financial privacy.</p>
          </div>
          <div className="faq-item">
            <h4>Who can see my decrypted data?</h4>
            <p>Only you can decrypt and view your actual debt amounts. The decryption happens locally in your browser using your wallet keys.</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Debt Management 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted debt management system and access your private financial data.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start managing your debts with complete privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted debt management system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Debt Management 🔐</h1>
          <p>FHE-Protected Financial Privacy</p>
        </div>
        
        <div className="header-actions">
          <button className="system-check-btn" onClick={checkAvailability}>
            Check FHE System
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Debt Record
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Encrypted Debt Overview</h2>
          {renderStatsPanel()}
          
          <div className="control-panel">
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>
            <button 
              onClick={() => setShowFAQ(!showFAQ)}
              className="faq-btn"
            >
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>

          {showFAQ && renderFAQ()}
        </div>
        
        <div className="debts-section">
          <div className="section-header">
            <h2>Your Encrypted Debt Records</h2>
            <div className="section-info">
              <span className="info-badge">{debts.length} records</span>
              <span className="info-badge encrypted">FHE Encrypted</span>
            </div>
          </div>
          
          <div className="debts-list">
            {debts.length === 0 ? (
              <div className="no-debts">
                <p>No debt records found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Record
                </button>
              </div>
            ) : debts.map((debt, index) => (
              <DebtCard 
                key={index}
                debt={debt}
                onSelect={setSelectedDebt}
                onDecrypt={decryptData}
              />
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateDebt 
          onSubmit={createDebt} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingDebt} 
          debtData={newDebtData} 
          setDebtData={setNewDebtData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedDebt && (
        <DebtDetailModal 
          debt={selectedDebt} 
          onClose={() => setSelectedDebt(null)} 
          onDecrypt={decryptData}
          isDecrypting={fheIsDecrypting}
          calculateRepaymentPlan={calculateRepaymentPlan}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const DebtCard: React.FC<{
  debt: DebtData;
  onSelect: (debt: DebtData) => void;
  onDecrypt: (businessId: string) => Promise<number | null>;
}> = ({ debt, onSelect, onDecrypt }) => {
  const [isDecrypting, setIsDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDecrypting(true);
    await onDecrypt(debt.id);
    setIsDecrypting(false);
  };

  return (
    <div className="debt-card" onClick={() => onSelect(debt)}>
      <div className="debt-header">
        <h3>{debt.name}</h3>
        <span className={`status-badge ${debt.isVerified ? 'verified' : 'encrypted'}`}>
          {debt.isVerified ? '✅ Verified' : '🔒 Encrypted'}
        </span>
      </div>
      
      <div className="debt-details">
        <div className="detail-item">
          <span>Interest Rate:</span>
          <strong>{debt.interestRate}%</strong>
        </div>
        <div className="detail-item">
          <span>Term:</span>
          <strong>{debt.term} months</strong>
        </div>
        <div className="detail-item">
          <span>Amount:</span>
          <strong>
            {debt.isVerified && debt.decryptedValue ? 
              `$${debt.decryptedValue.toLocaleString()}` : 
              '🔒 FHE Encrypted'
            }
          </strong>
        </div>
      </div>
      
      <div className="debt-footer">
        <span className="debt-date">
          {new Date(debt.timestamp * 1000).toLocaleDateString()}
        </span>
        <button 
          className={`decrypt-btn ${debt.isVerified ? 'verified' : ''}`}
          onClick={handleDecrypt}
          disabled={isDecrypting}
        >
          {isDecrypting ? 'Decrypting...' : debt.isVerified ? 'Verified' : 'Decrypt'}
        </button>
      </div>
    </div>
  );
};

const ModalCreateDebt: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  debtData: any;
  setDebtData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, debtData, setDebtData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'amount') {
      const intValue = value.replace(/[^\d]/g, '');
      setDebtData({ ...debtData, [name]: intValue });
    } else {
      setDebtData({ ...debtData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-debt-modal">
        <div className="modal-header">
          <h2>New Encrypted Debt Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Debt amount will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Debt Name *</label>
            <input 
              type="text" 
              name="name" 
              value={debtData.name} 
              onChange={handleChange} 
              placeholder="Enter debt name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Debt Amount (Integer only) *</label>
            <input 
              type="number" 
              name="amount" 
              value={debtData.amount} 
              onChange={handleChange} 
              placeholder="Enter debt amount..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Interest Rate (%) *</label>
            <input 
              type="number" 
              min="0" 
              max="50" 
              name="interestRate" 
              value={debtData.interestRate} 
              onChange={handleChange} 
              placeholder="Enter interest rate..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Term (months) *</label>
            <input 
              type="number" 
              min="1" 
              max="360" 
              name="term" 
              value={debtData.term} 
              onChange={handleChange} 
              placeholder="Enter loan term..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={debtData.description} 
              onChange={handleChange} 
              placeholder="Enter debt description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !debtData.name || !debtData.amount} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Encrypted Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DebtDetailModal: React.FC<{
  debt: DebtData;
  onClose: () => void;
  onDecrypt: (businessId: string) => Promise<number | null>;
  isDecrypting: boolean;
  calculateRepaymentPlan: (debt: DebtData, decryptedAmount: number | null) => any;
}> = ({ debt, onClose, onDecrypt, isDecrypting, calculateRepaymentPlan }) => {
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [localDecrypting, setLocalDecrypting] = useState(false);

  const handleDecrypt = async () => {
    if (debt.isVerified) return;
    
    setLocalDecrypting(true);
    const amount = await onDecrypt(debt.id);
    setDecryptedAmount(amount);
    setLocalDecrypting(false);
  };

  const repaymentPlan = calculateRepaymentPlan(debt, decryptedAmount);
  const showRepayment = debt.isVerified || decryptedAmount !== null;

  return (
    <div className="modal-overlay">
      <div className="debt-detail-modal">
        <div className="modal-header">
          <h2>Debt Record Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="debt-info-grid">
            <div className="info-item">
              <span>Debt Name:</span>
              <strong>{debt.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{debt.creator.substring(0, 6)}...{debt.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(debt.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Interest Rate:</span>
              <strong>{debt.interestRate}%</strong>
            </div>
            <div className="info-item">
              <span>Loan Term:</span>
              <strong>{debt.term} months</strong>
            </div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted Debt Amount</h3>
            <div className="data-row">
              <div className="data-label">Principal Amount:</div>
              <div className="data-value">
                {debt.isVerified && debt.decryptedValue ? 
                  `$${debt.decryptedValue.toLocaleString()} (On-chain Verified)` : 
                  decryptedAmount !== null ? 
                  `$${decryptedAmount.toLocaleString()} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn large ${debt.isVerified ? 'verified' : decryptedAmount !== null ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || localDecrypting}
              >
                {isDecrypting || localDecrypting ? "🔓 Decrypting..." :
                 debt.isVerified ? "✅ Verified" :
                 decryptedAmount !== null ? "🔄 Re-verify" :
                 "🔓 Decrypt Amount"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Calculation</strong>
                <p>Your debt amount remains encrypted during all calculations. Decryption only occurs locally with your explicit permission.</p>
              </div>
            </div>
          </div>
          
          {showRepayment && (
            <div className="repayment-section">
              <h3>Repayment Plan Analysis</h3>
              <div className="repayment-grid">
                <div className="repayment-item">
                  <span>Monthly Payment:</span>
                  <strong>${repaymentPlan.monthlyPayment.toLocaleString()}</strong>
                </div>
                <div className="repayment-item">
                  <span>Total Payment:</span>
                  <strong>${repaymentPlan.totalPayment.toLocaleString()}</strong>
                </div>
                <div className="repayment-item">
                  <span>Total Interest:</span>
                  <strong>${repaymentPlan.totalInterest.toLocaleString()}</strong>
                </div>
              </div>
              
              <div className="verification-status">
                <span className={`status ${debt.isVerified ? 'verified' : 'local'}`}>
                  {debt.isVerified ? '✅ On-chain Verified' : '🔓 Locally Decrypted'}
                </span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!debt.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting || localDecrypting}
              className="verify-btn"
            >
              {isDecrypting || localDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

