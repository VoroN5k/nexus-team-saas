## Advanced Feature: Multi-Sig Zero-Knowledge Vault

The **NexusTeam Vault** is a high-security module designed for storing sensitive organization data (e.g., Production API Keys, Database Credentials, Recovery Phrases). It leverages **Shamir's Secret Sharing (SSS)** to ensure that no single individual — and not even the server — has full access to the secrets.

### 🛠 How it Works (Technical Workflow)

#### 1. Visual Interface & State Management
The Vault UI provides a clear overview of the security status for each secret using a real-time status indicator:
* 🔴 **Locked:** The secret is encrypted and requires a quorum to be accessed.
* 🟡 **Pending:** An access request is active (e.g., 1 of 3 required signatures collected).
* 🟢 **Unlocked:** The secret has been reconstructed and is available in the browser's volatile memory for the current session.

#### 2. Secure Secret Creation (The "Split")
When an administrator creates a new secret:
1.  **Input:** They provide the secret value and define the security policy (Threshold $k$ and Total Holders $n$).
2.  **Sharding:** Using `secrets.js`, the Angular frontend splits the secret into $n$ unique cryptographic shares.
3.  **Client-Side Encryption:** Each share is encrypted using the **Public Key** of the designated "Key Holders."
4.  **Zero-Knowledge Storage:** Only the encrypted shares are sent to the **Nest.js** backend and stored in the **Supabase (PostgreSQL)** database. The raw secret never touches the server.

#### 3. Quorum Reconstruction (The "Unlock")
To view a secret, a "Quorum" must be established:
1.  **Access Request:** A user clicks "Request Access," triggering a **WebSocket** notification to all designated Key Holders.
2.  **Decryption:** Holders must enter their personal **Master PIN** to decrypt their specific share using their local Private Key (derived via **PBKDF2**).
3.  **Collection:** As soon as the **Nest.js** gateway detects that the threshold $k$ has been met, it transmits the required shares to the requester's browser.
4.  **Reconstruction:** The Angular frontend performs **Lagrange Interpolation** to reconstruct the original secret value instantly.

### Security Highlights
* **Zero-Knowledge:** The server has zero knowledge of the raw secrets.
* **No Single Point of Failure:** Even if an administrator's account is compromised, the attacker cannot access the Vault without reaching the quorum threshold.
* **Immune to DB Leaks:** A full database dump reveals only encrypted fragments that are mathematically useless without the holders' private keys.