# 📄 Project Technical Specification

## 🏗 Project Identity
* **Name:** MVP NexusTeam – Modern Team Workspace SaaS
* **Description:** A scalable SaaS platform designed for collaborative team management. The system enables the creation of isolated workspaces (**Multi-tenancy**), ensuring that each organization can manage its members, roles, and resources in a secure and partitioned environment.

---

## 💻 Technical Stack & Infrastructure

### **Frontend**
* **Framework:** Angular 18+
* **Key Features:** Signals-based state management, Reactive Forms, and modular architecture.

### **Backend**
* **Framework:** Nest.js (Node.js)
* **Architecture:** Custom RESTful API with structured Dependency Injection and modular design.

### **Database & Storage**
* **Provider:** Supabase
* **Engine:** PostgreSQL
* **ORM:** Prisma ORM for type-safe database access and migrations.

### **Security & Authentication**
* **Mechanism:** JWT (JSON Web Tokens)
* **Session Management:** Implementation of **Silent Refresh** with Refresh Tokens.
* **Data Isolation:** Row Level Security (RLS) to ensure multi-tenant data privacy.

---

## 🛠 Core Functionalities

### 🏦 Organization & Workspace
* **Organization Registration:** Seamless onboarding for new companies.
* **Workspace Management:** Creation and configuration of dedicated team environments.

### 📋 Task Management
* **Full CRUD Operations:** Comprehensive system to Create, Read, Update, and Delete tasks.
* **Real-time Updates:** (Optional) Synchronized task status across team members.

### 🔐 Access Control
* **Role-Based Access Control (RBAC):** Granular system to define permissions for different team members (e.g., Admin, Member, Guest).

### 📊 Visualization
* **Simple Dashboard:** A streamlined overview of team activity, task progress, and workspace metrics.