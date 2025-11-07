pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DebtManagement is ZamaEthereumConfig {
    struct DebtRecord {
        string debtId;
        euint32 encryptedAmount;
        uint256 interestRate;
        uint256 termMonths;
        address owner;
        uint256 creationDate;
        uint32 decryptedAmount;
        bool isVerified;
    }

    mapping(string => DebtRecord) public debtRecords;
    string[] public debtIds;

    event DebtRecordCreated(string indexed debtId, address indexed owner);
    event DebtVerification(string indexed debtId, uint32 decryptedAmount);

    constructor() ZamaEthereumConfig() {}

    function createDebtRecord(
        string calldata debtId,
        externalEuint32 encryptedAmount,
        bytes calldata inputProof,
        uint256 interestRate,
        uint256 termMonths
    ) external {
        require(bytes(debtRecords[debtId].debtId).length == 0, "Debt record already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, inputProof)), "Invalid encrypted amount");

        debtRecords[debtId] = DebtRecord({
            debtId: debtId,
            encryptedAmount: FHE.fromExternal(encryptedAmount, inputProof),
            interestRate: interestRate,
            termMonths: termMonths,
            owner: msg.sender,
            creationDate: block.timestamp,
            decryptedAmount: 0,
            isVerified: false
        });

        FHE.allowThis(debtRecords[debtId].encryptedAmount);
        FHE.makePubliclyDecryptable(debtRecords[debtId].encryptedAmount);
        debtIds.push(debtId);

        emit DebtRecordCreated(debtId, msg.sender);
    }

    function verifyDebtAmount(
        string calldata debtId,
        bytes memory abiEncodedClearAmount,
        bytes memory decryptionProof
    ) external {
        require(bytes(debtRecords[debtId].debtId).length > 0, "Debt record does not exist");
        require(!debtRecords[debtId].isVerified, "Debt already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(debtRecords[debtId].encryptedAmount);

        FHE.checkSignatures(cts, abiEncodedClearAmount, decryptionProof);
        uint32 decodedAmount = abi.decode(abiEncodedClearAmount, (uint32));

        debtRecords[debtId].decryptedAmount = decodedAmount;
        debtRecords[debtId].isVerified = true;

        emit DebtVerification(debtId, decodedAmount);
    }

    function calculateMonthlyPayment(string calldata debtId) external view returns (euint32) {
        require(bytes(debtRecords[debtId].debtId).length > 0, "Debt record does not exist");

        uint256 monthlyRate = debtRecords[debtId].interestRate / 12;
        uint256 months = debtRecords[debtId].termMonths;

        // Convert to fixed-point arithmetic for FHE operations
        uint32 fixedRate = uint32(monthlyRate * 1000);
        uint32 fixedMonths = uint32(months * 1000);

        euint32 rateFactor = FHE.encrypt(fixedRate);
        euint32 monthFactor = FHE.encrypt(fixedMonths);

        // Monthly payment = (Amount * MonthlyRate) / (1 - (1 + MonthlyRate)^-TermMonths)
        euint32 numerator = FHE.mul(debtRecords[debtId].encryptedAmount, rateFactor);
        euint32 denominator = FHE.sub(
            FHE.encrypt(1000),
            FHE.exp(
                FHE.add(FHE.encrypt(1000), rateFactor),
                FHE.sub(FHE.encrypt(0), monthFactor)
            )
        );

        return FHE.div(numerator, denominator);
    }

    function getDebtRecord(string calldata debtId) external view returns (
        string memory,
        uint256,
        uint256,
        address,
        uint256,
        bool,
        uint32
    ) {
        require(bytes(debtRecords[debtId].debtId).length > 0, "Debt record does not exist");
        DebtRecord storage record = debtRecords[debtId];

        return (
            record.debtId,
            record.interestRate,
            record.termMonths,
            record.owner,
            record.creationDate,
            record.isVerified,
            record.decryptedAmount
        );
    }

    function getAllDebtIds() external view returns (string[] memory) {
        return debtIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

