const LOCAL_CACHE_KEY = "web_bookkeeping_cache_v2";
const LAST_EXPORT_KEY = "web_bookkeeping_last_export";
const REMOTE_TABLE = "user_bookkeeping_data";

function debounce(fn, delay = 200) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

class WebBookkeepingApp {
    constructor() {
        this.charts = {};
        this.currentEditingId = null;
        this.toastTimer = null;
        this.saveTimer = null;
        this.supabase = null;
        this.user = null;
        this.authConfigured = false;
        this.authStateMessage = "";
        this.currencyFormatter = new Intl.NumberFormat("zh-CN", {
            style: "currency",
            currency: "CNY",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        this.data = this.loadLocalCache();
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        this.bootstrapDefaults();
        this.sortTransactions();
        this.renderAll();
        this.setAppLocked(true);
        this.updateAuthUi();

        this.authConfigured = this.initializeSupabaseClient();
        if (!this.authConfigured) {
            this.setAuthMessage("请先在 supabase-config.js 填写 Supabase URL 和 anon key。");
            this.showToast("未配置 Supabase，无法登录。", "error");
            return;
        }

        this.setAuthMessage("正在检查登录状态...");
        this.setAuthButtonsLoading(true);

        try {
            const { data, error } = await this.supabase.auth.getSession();
            if (error) {
                throw error;
            }
            await this.handleSession(data?.session || null, false, "INITIAL");
        } catch (error) {
            console.error("读取登录状态失败：", error);
            this.setAuthMessage("无法连接认证服务，请稍后重试。");
            this.showToast("认证服务异常，请稍后重试。", "error");
        } finally {
            this.setAuthButtonsLoading(false);
        }

        this.supabase.auth.onAuthStateChange((event, session) => {
            this.handleSession(session, true, event).catch((error) => {
                console.error("处理会话状态失败：", error);
                this.showToast("会话状态更新失败", "error");
            });
        });
    }

    initializeSupabaseClient() {
        if (!window.supabase || typeof window.supabase.createClient !== "function") {
            this.setAuthMessage("未成功加载 Supabase SDK，请检查网络。");
            return false;
        }

        const config = window.SUPABASE_CONFIG || {};
        const url = String(config.url || "").trim();
        const anonKey = String(config.anonKey || "").trim();
        const looksLikePlaceholder =
            !url ||
            !anonKey ||
            url.includes("YOUR_") ||
            anonKey.includes("YOUR_") ||
            url.includes("example");

        if (looksLikePlaceholder) {
            return false;
        }

        try {
            this.supabase = window.supabase.createClient(url, anonKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true
                }
            });
            return true;
        } catch (error) {
            console.error("初始化 Supabase 客户端失败：", error);
            this.setAuthMessage("Supabase 配置无效，请检查 supabase-config.js。");
            return false;
        }
    }

    async handleSession(session, notify = true, eventName = "") {
        const nextUser = session?.user || null;
        this.user = nextUser;
        this.updateAuthUi();

        if (!nextUser) {
            this.data = this.buildDefaultData();
            this.saveLocalCache();
            this.bootstrapDefaults();
            this.sortTransactions();
            this.renderAll();
            this.setAppLocked(true);
            this.setAuthMessage("请登录后开始记账。");
            if (notify && eventName === "SIGNED_OUT") {
                this.showToast("已退出登录", "success");
            }
            return;
        }

        this.setAuthButtonsLoading(true);
        this.setAuthMessage("登录成功，正在同步云端数据...");
        this.setAppLocked(false);

        try {
            await this.loadRemoteData();
            this.setAuthMessage("数据已同步，你可以开始记账。");
            if (notify && (eventName === "SIGNED_IN" || eventName === "TOKEN_REFRESHED")) {
                this.showToast("登录成功，数据已同步。", "success");
            }
        } catch (error) {
            console.error("加载云端数据失败：", error);
            this.setAppLocked(true);
            this.setAuthMessage("读取云端数据失败，请检查 Supabase 表结构和权限。");
            this.showToast("云端数据读取失败，请检查配置。", "error");
        } finally {
            this.setAuthButtonsLoading(false);
        }
    }

    async loadRemoteData() {
        if (!this.supabase || !this.user) return;

        const userId = this.user.id;
        const { data, error } = await this.supabase
            .from(REMOTE_TABLE)
            .select("payload, updated_at")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (data?.payload) {
            this.data = this.normalizeData(data.payload);
        } else {
            this.data = this.buildDefaultData();
            await this.persistDataNow();
        }

        this.sortTransactions();
        this.saveLocalCache();
        this.bootstrapDefaults();
        this.resetTransactionForm(false);
        this.renderAll();
    }

    buildDefaultData() {
        const now = new Date().toISOString();
        return {
            version: 1,
            settings: {
                currency: "CNY"
            },
            accounts: [
                { id: "cash", name: "现金", icon: "💵", color: "#f59e0b", initialBalance: 0, isDefault: true },
                { id: "wechat", name: "微信", icon: "💬", color: "#22c55e", initialBalance: 0, isDefault: true },
                { id: "alipay", name: "支付宝", icon: "🧾", color: "#3b82f6", initialBalance: 0, isDefault: true },
                { id: "bank", name: "银行卡", icon: "🏦", color: "#6366f1", initialBalance: 0, isDefault: true }
            ],
            categories: [
                { id: "expense_food", name: "餐饮", type: "expense", icon: "🍜", color: "#f97316", isDefault: true },
                { id: "expense_transport", name: "交通", type: "expense", icon: "🚇", color: "#06b6d4", isDefault: true },
                { id: "expense_housing", name: "住房", type: "expense", icon: "🏠", color: "#8b5cf6", isDefault: true },
                { id: "expense_shopping", name: "购物", type: "expense", icon: "🛍️", color: "#ec4899", isDefault: true },
                { id: "expense_entertainment", name: "娱乐", type: "expense", icon: "🎬", color: "#0ea5e9", isDefault: true },
                { id: "expense_medical", name: "医疗", type: "expense", icon: "💊", color: "#ef4444", isDefault: true },
                { id: "expense_education", name: "学习", type: "expense", icon: "📘", color: "#14b8a6", isDefault: true },
                { id: "expense_daily", name: "日用", type: "expense", icon: "🧴", color: "#f59e0b", isDefault: true },
                { id: "income_salary", name: "工资", type: "income", icon: "💼", color: "#22c55e", isDefault: true },
                { id: "income_bonus", name: "奖金", type: "income", icon: "🎁", color: "#84cc16", isDefault: true },
                { id: "income_side", name: "副业", type: "income", icon: "🧑‍💻", color: "#10b981", isDefault: true },
                { id: "income_investment", name: "理财收益", type: "income", icon: "📈", color: "#0ea5e9", isDefault: true },
                { id: "income_refund", name: "退款", type: "income", icon: "↩️", color: "#3b82f6", isDefault: true }
            ],
            transactions: [],
            budgets: [],
            meta: {
                createdAt: now,
                updatedAt: now
            }
        };
    }

    normalizeData(rawInput) {
        const defaults = this.buildDefaultData();
        const raw = rawInput && typeof rawInput === "object" ? rawInput : {};
        const normalized = { ...defaults, ...raw };

        normalized.accounts = Array.isArray(raw.accounts) && raw.accounts.length > 0
            ? raw.accounts.map((account, index) => ({
                id: String(account.id || `acc_${index}`),
                name: String(account.name || `账户${index + 1}`),
                icon: String(account.icon || "🏦"),
                color: String(account.color || "#6366f1"),
                initialBalance: this.normalizeMoney(account.initialBalance),
                isDefault: Boolean(account.isDefault)
            }))
            : defaults.accounts;

        normalized.categories = Array.isArray(raw.categories) && raw.categories.length > 0
            ? raw.categories
                .map((category, index) => {
                    const type = category.type === "income" ? "income" : "expense";
                    return {
                        id: String(category.id || `category_${index}`),
                        name: String(category.name || `分类${index + 1}`),
                        type,
                        icon: String(category.icon || (type === "income" ? "💰" : "🧾")),
                        color: String(category.color || (type === "income" ? "#22c55e" : "#f97316")),
                        isDefault: Boolean(category.isDefault)
                    };
                })
            : defaults.categories;

        const accountIds = new Set(normalized.accounts.map((account) => account.id));
        const categoryMap = new Map(normalized.categories.map((category) => [category.id, category]));

        normalized.transactions = Array.isArray(raw.transactions)
            ? raw.transactions
                .map((transaction, index) => ({
                    id: String(transaction.id || `tx_${index}`),
                    date: String(transaction.date || ""),
                    type: transaction.type === "income" ? "income" : "expense",
                    amount: this.normalizeMoney(transaction.amount),
                    accountId: String(transaction.accountId || ""),
                    categoryId: String(transaction.categoryId || ""),
                    note: String(transaction.note || "").trim().slice(0, 60),
                    createdAt: transaction.createdAt || new Date().toISOString(),
                    updatedAt: transaction.updatedAt || transaction.createdAt || new Date().toISOString()
                }))
                .filter((transaction) => {
                    if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) {
                        return false;
                    }
                    if (!accountIds.has(transaction.accountId)) {
                        return false;
                    }
                    const category = categoryMap.get(transaction.categoryId);
                    if (!category) {
                        return false;
                    }
                    if (category.type !== transaction.type) {
                        return false;
                    }
                    return transaction.amount > 0;
                })
            : [];

        normalized.budgets = Array.isArray(raw.budgets)
            ? raw.budgets
                .map((budget, index) => ({
                    id: String(budget.id || `budget_${index}`),
                    month: String(budget.month || "").slice(0, 7),
                    categoryId: String(budget.categoryId || ""),
                    amount: this.normalizeMoney(budget.amount),
                    createdAt: budget.createdAt || new Date().toISOString(),
                    updatedAt: budget.updatedAt || budget.createdAt || new Date().toISOString()
                }))
                .filter((budget) => {
                    if (!/^\d{4}-\d{2}$/.test(budget.month)) {
                        return false;
                    }
                    const category = categoryMap.get(budget.categoryId);
                    return Boolean(category && category.type === "expense" && budget.amount > 0);
                })
            : [];

        normalized.meta = {
            createdAt: raw.meta?.createdAt || defaults.meta.createdAt,
            updatedAt: raw.meta?.updatedAt || defaults.meta.updatedAt
        };

        return normalized;
    }

    loadLocalCache() {
        try {
            const raw = localStorage.getItem(LOCAL_CACHE_KEY);
            if (!raw) return this.buildDefaultData();
            return this.normalizeData(JSON.parse(raw));
        } catch (error) {
            console.error("加载本地缓存失败，已回退默认数据：", error);
            return this.buildDefaultData();
        }
    }

    saveLocalCache() {
        localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(this.data));
    }

    saveData({ immediate = false } = {}) {
        this.data.meta.updatedAt = new Date().toISOString();
        this.saveLocalCache();

        if (!this.user || !this.supabase) return;

        if (immediate) {
            this.persistDataNow().catch((error) => {
                console.error("云端保存失败：", error);
                this.showToast("云端保存失败，请稍后重试。", "error");
            });
            return;
        }

        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.persistDataNow().catch((error) => {
                console.error("云端保存失败：", error);
                this.showToast("云端保存失败，请稍后重试。", "error");
            });
        }, 400);
    }

    async persistDataNow() {
        if (!this.user || !this.supabase) return;
        const payload = this.normalizeData(this.data);
        const { error } = await this.supabase
            .from(REMOTE_TABLE)
            .upsert(
                {
                    user_id: this.user.id,
                    payload,
                    updated_at: new Date().toISOString()
                },
                { onConflict: "user_id" }
            );

        if (error) {
            throw error;
        }
    }

    cacheElements() {
        this.tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
        this.tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

        this.el = {
            appShell: document.getElementById("appShell"),
            authGate: document.getElementById("authGate"),
            authHint: document.getElementById("authHint"),
            authEmail: document.getElementById("authEmail"),
            authPassword: document.getElementById("authPassword"),
            loginBtn: document.getElementById("loginBtn"),
            registerBtn: document.getElementById("registerBtn"),
            logoutBtn: document.getElementById("logoutBtn"),
            authUserLabel: document.getElementById("authUserLabel"),

            quickAddBtn: document.getElementById("quickAddBtn"),
            overviewMonth: document.getElementById("overviewMonth"),
            overviewMonthLabel: document.getElementById("overviewMonthLabel"),
            statBalance: document.getElementById("statBalance"),
            statIncome: document.getElementById("statIncome"),
            statExpense: document.getElementById("statExpense"),
            statSavingRate: document.getElementById("statSavingRate"),
            recentTransactions: document.getElementById("recentTransactions"),

            txDate: document.getElementById("txDate"),
            txType: document.getElementById("txType"),
            txAmount: document.getElementById("txAmount"),
            txAccount: document.getElementById("txAccount"),
            txCategory: document.getElementById("txCategory"),
            txNote: document.getElementById("txNote"),
            saveTxBtn: document.getElementById("saveTxBtn"),
            resetTxBtn: document.getElementById("resetTxBtn"),
            transactionFormTitle: document.getElementById("transactionFormTitle"),

            filterMonth: document.getElementById("filterMonth"),
            filterType: document.getElementById("filterType"),
            filterCategory: document.getElementById("filterCategory"),
            filterKeyword: document.getElementById("filterKeyword"),
            clearFiltersBtn: document.getElementById("clearFiltersBtn"),
            transactionsTableBody: document.getElementById("transactionsTableBody"),
            filteredIncome: document.getElementById("filteredIncome"),
            filteredExpense: document.getElementById("filteredExpense"),
            filteredNet: document.getElementById("filteredNet"),

            budgetMonth: document.getElementById("budgetMonth"),
            budgetCategory: document.getElementById("budgetCategory"),
            budgetAmount: document.getElementById("budgetAmount"),
            saveBudgetBtn: document.getElementById("saveBudgetBtn"),
            budgetSummaryText: document.getElementById("budgetSummaryText"),
            budgetList: document.getElementById("budgetList"),

            accountList: document.getElementById("accountList"),
            newAccountName: document.getElementById("newAccountName"),
            newAccountIcon: document.getElementById("newAccountIcon"),
            newAccountColor: document.getElementById("newAccountColor"),
            newAccountInitialBalance: document.getElementById("newAccountInitialBalance"),
            addAccountBtn: document.getElementById("addAccountBtn"),

            categoryList: document.getElementById("categoryList"),
            newCategoryName: document.getElementById("newCategoryName"),
            newCategoryType: document.getElementById("newCategoryType"),
            newCategoryIcon: document.getElementById("newCategoryIcon"),
            newCategoryColor: document.getElementById("newCategoryColor"),
            addCategoryBtn: document.getElementById("addCategoryBtn"),

            exportDataBtn: document.getElementById("exportDataBtn"),
            importDataBtn: document.getElementById("importDataBtn"),
            clearDataBtn: document.getElementById("clearDataBtn"),
            importFileInput: document.getElementById("importFileInput"),

            dataStats: document.getElementById("dataStats"),
            lastBackupTime: document.getElementById("lastBackupTime"),

            toast: document.getElementById("toast")
        };
    }

    bindEvents() {
        this.tabButtons.forEach((button) => {
            button.addEventListener("click", () => this.switchTab(button.dataset.tab));
        });

        this.el.quickAddBtn.addEventListener("click", () => {
            if (!this.ensureAuthenticated()) return;
            this.switchTab("transactions");
            this.el.txAmount.focus();
        });

        this.el.loginBtn.addEventListener("click", () => {
            this.loginWithPassword().catch((error) => {
                console.error(error);
                this.showToast("登录失败，请稍后重试。", "error");
            });
        });
        this.el.registerBtn.addEventListener("click", () => {
            this.registerWithPassword().catch((error) => {
                console.error(error);
                this.showToast("注册失败，请稍后重试。", "error");
            });
        });
        this.el.logoutBtn.addEventListener("click", () => {
            this.logout().catch((error) => {
                console.error(error);
                this.showToast("退出失败，请稍后重试。", "error");
            });
        });
        this.el.authPassword.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                this.loginWithPassword().catch((error) => {
                    console.error(error);
                    this.showToast("登录失败，请稍后重试。", "error");
                });
            }
        });

        this.el.overviewMonth.addEventListener("change", () => this.renderOverview());

        this.el.txType.addEventListener("change", () => this.renderTransactionCategoryOptions());
        this.el.saveTxBtn.addEventListener("click", () => this.handleSaveTransaction());
        this.el.resetTxBtn.addEventListener("click", () => this.resetTransactionForm(true));

        this.el.filterMonth.addEventListener("change", () => this.renderTransactionsTable());
        this.el.filterCategory.addEventListener("change", () => this.renderTransactionsTable());
        this.el.filterKeyword.addEventListener("input", () => this.renderTransactionsTable());
        this.el.filterType.addEventListener("change", () => {
            this.renderFilterCategoryOptions();
            this.renderTransactionsTable();
        });

        this.el.clearFiltersBtn.addEventListener("click", () => {
            this.el.filterMonth.value = "";
            this.el.filterType.value = "";
            this.el.filterKeyword.value = "";
            this.renderFilterCategoryOptions();
            this.renderTransactionsTable();
        });

        this.el.transactionsTableBody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) return;

            const action = button.dataset.action;
            const id = button.dataset.id;
            if (!id) return;

            if (action === "edit") {
                this.editTransaction(id);
            } else if (action === "delete") {
                this.deleteTransaction(id);
            }
        });

        this.el.budgetMonth.addEventListener("change", () => this.renderBudgetList());
        this.el.saveBudgetBtn.addEventListener("click", () => this.handleSaveBudget());
        this.el.budgetList.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action='remove-budget']");
            if (!button) return;
            const budgetId = button.dataset.id;
            if (budgetId) this.removeBudget(budgetId);
        });

        this.el.addAccountBtn.addEventListener("click", () => this.addAccount());
        this.el.accountList.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action='remove-account']");
            if (!button) return;
            const accountId = button.dataset.id;
            if (accountId) this.removeAccount(accountId);
        });

        this.el.addCategoryBtn.addEventListener("click", () => this.addCategory());
        this.el.categoryList.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action='remove-category']");
            if (!button) return;
            const categoryId = button.dataset.id;
            if (categoryId) this.removeCategory(categoryId);
        });

        this.el.exportDataBtn.addEventListener("click", () => this.exportData());
        this.el.importDataBtn.addEventListener("click", () => this.triggerImport());
        this.el.clearDataBtn.addEventListener("click", () => this.clearAllData());
        this.el.importFileInput.addEventListener("change", (event) => this.importDataFromFile(event));

        window.addEventListener(
            "resize",
            debounce(() => {
                const overviewPanel = document.getElementById("overview");
                if (overviewPanel?.classList.contains("active") && this.user) {
                    this.renderOverviewCharts();
                }
            }, 260)
        );
    }

    async loginWithPassword() {
        if (!this.authConfigured || !this.supabase) {
            this.showToast("未配置 Supabase，请先修改配置文件。", "error");
            return;
        }

        const email = this.el.authEmail.value.trim();
        const password = this.el.authPassword.value;
        if (!this.validateAuthInput(email, password)) return;

        this.setAuthButtonsLoading(true);
        this.setAuthMessage("正在登录...");

        const { error } = await this.supabase.auth.signInWithPassword({ email, password });
        this.setAuthButtonsLoading(false);

        if (error) {
            this.setAuthMessage(error.message || "登录失败，请检查邮箱和密码。");
            this.showToast(`登录失败：${error.message || "请检查凭证"}`, "error");
            return;
        }

        this.el.authPassword.value = "";
        this.showToast("登录请求成功。", "success");
    }

    async registerWithPassword() {
        if (!this.authConfigured || !this.supabase) {
            this.showToast("未配置 Supabase，请先修改配置文件。", "error");
            return;
        }

        const email = this.el.authEmail.value.trim();
        const password = this.el.authPassword.value;
        if (!this.validateAuthInput(email, password)) return;

        this.setAuthButtonsLoading(true);
        this.setAuthMessage("正在注册...");

        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { data, error } = await this.supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo: redirectTo
            }
        });

        this.setAuthButtonsLoading(false);

        if (error) {
            this.setAuthMessage(error.message || "注册失败，请稍后重试。");
            this.showToast(`注册失败：${error.message || "请稍后重试"}`, "error");
            return;
        }

        this.el.authPassword.value = "";
        if (data?.session) {
            this.showToast("注册并登录成功。", "success");
            return;
        }
        this.setAuthMessage("注册成功，请到邮箱完成验证后再登录。");
        this.showToast("注册成功，请先验证邮箱。", "success");
    }

    async logout() {
        if (!this.supabase) return;
        if (!this.user) return;

        this.setAuthButtonsLoading(true);
        const { error } = await this.supabase.auth.signOut();
        this.setAuthButtonsLoading(false);

        if (error) {
            this.showToast(`退出失败：${error.message || "请重试"}`, "error");
            return;
        }
    }

    validateAuthInput(email, password) {
        const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailReg.test(email)) {
            this.showToast("请输入有效邮箱地址。", "error");
            return false;
        }
        if (!password || password.length < 6) {
            this.showToast("密码至少 6 位。", "error");
            return false;
        }
        return true;
    }

    setAuthButtonsLoading(isLoading) {
        const hasUser = Boolean(this.user);
        this.el.loginBtn.disabled = isLoading || hasUser || !this.authConfigured;
        this.el.registerBtn.disabled = isLoading || hasUser || !this.authConfigured;
        this.el.logoutBtn.disabled = isLoading || !hasUser;
    }

    setAuthMessage(message) {
        this.authStateMessage = message;
        if (this.el.authHint) {
            this.el.authHint.textContent = message;
        }
    }

    setAppLocked(locked) {
        this.el.appShell.classList.toggle("locked", locked);
        this.el.authGate.classList.toggle("active", locked);
        this.el.quickAddBtn.disabled = locked;
        this.el.overviewMonth.disabled = locked;
    }

    updateAuthUi() {
        if (this.user) {
            this.el.authUserLabel.textContent = `已登录：${this.user.email || "未知用户"}`;
            this.el.logoutBtn.hidden = false;
        } else {
            this.el.authUserLabel.textContent = "未登录";
            this.el.logoutBtn.hidden = true;
        }
    }

    ensureAuthenticated(showPrompt = true) {
        if (this.user) return true;
        if (showPrompt) {
            this.showToast("请先登录后操作。", "error");
        }
        return false;
    }

    bootstrapDefaults() {
        const currentMonth = this.getCurrentMonth();
        const currentDate = this.getCurrentDate();

        if (!this.el.overviewMonth.value) this.el.overviewMonth.value = currentMonth;
        if (!this.el.txDate.value) this.el.txDate.value = currentDate;
        if (!this.el.filterMonth.value) this.el.filterMonth.value = currentMonth;
        if (!this.el.budgetMonth.value) this.el.budgetMonth.value = currentMonth;
        if (!this.el.txType.value) this.el.txType.value = "expense";

        this.renderAccountOptions();
        this.renderTransactionCategoryOptions();
        this.renderFilterCategoryOptions();
        this.renderBudgetCategoryOptions();
    }

    renderAll() {
        this.renderAccountOptions();
        this.renderTransactionCategoryOptions();
        this.renderFilterCategoryOptions();
        this.renderBudgetCategoryOptions();
        this.renderOverview();
        this.renderTransactionsTable();
        this.renderBudgetList();
        this.renderSettingsLists();
        this.renderSystemInfo();
    }

    switchTab(tabName) {
        this.tabButtons.forEach((button) => {
            button.classList.toggle("active", button.dataset.tab === tabName);
        });

        this.tabPanels.forEach((panel) => {
            panel.classList.toggle("active", panel.id === tabName);
        });

        if (tabName === "overview") {
            this.renderOverview();
        } else if (tabName === "transactions") {
            this.renderTransactionsTable();
        } else if (tabName === "budget") {
            this.renderBudgetList();
        } else if (tabName === "settings") {
            this.renderSettingsLists();
            this.renderSystemInfo();
        }
    }

    populateSelect(select, options, preferredValue) {
        if (!select) return;

        const previousValue = preferredValue !== undefined ? preferredValue : select.value;
        select.innerHTML = "";

        options.forEach((item) => {
            const option = document.createElement("option");
            option.value = item.value;
            option.textContent = item.label;
            select.appendChild(option);
        });

        if (options.some((item) => item.value === previousValue)) {
            select.value = previousValue;
        } else if (options.length > 0) {
            select.value = options[0].value;
        }
    }

    renderAccountOptions() {
        const selected = this.el.txAccount.value;
        const options = this.data.accounts.map((account) => ({
            value: account.id,
            label: `${account.icon} ${account.name}`
        }));
        this.populateSelect(this.el.txAccount, options, selected);
    }

    renderTransactionCategoryOptions() {
        const selected = this.el.txCategory.value;
        const type = this.el.txType.value || "expense";
        const categories = this.data.categories.filter((category) => category.type === type);

        if (categories.length === 0) {
            this.populateSelect(this.el.txCategory, [{ value: "", label: "请先新增分类" }], "");
            this.el.txCategory.disabled = true;
            return;
        }

        const options = categories.map((category) => ({
            value: category.id,
            label: `${category.icon} ${category.name}`
        }));
        this.populateSelect(this.el.txCategory, options, selected);
        this.el.txCategory.disabled = false;
    }

    renderFilterCategoryOptions() {
        const selected = this.el.filterCategory.value;
        const filterType = this.el.filterType.value;

        let categories = this.data.categories;
        if (filterType === "income" || filterType === "expense") {
            categories = categories.filter((category) => category.type === filterType);
        }

        const options = [
            { value: "", label: "全部分类" },
            ...categories.map((category) => ({
                value: category.id,
                label: `${category.icon} ${category.name}`
            }))
        ];
        this.populateSelect(this.el.filterCategory, options, selected);
    }

    renderBudgetCategoryOptions() {
        const selected = this.el.budgetCategory.value;
        const categories = this.data.categories.filter((category) => category.type === "expense");

        if (categories.length === 0) {
            this.populateSelect(this.el.budgetCategory, [{ value: "", label: "暂无支出分类" }], "");
            this.el.budgetCategory.disabled = true;
            return;
        }

        this.populateSelect(
            this.el.budgetCategory,
            categories.map((category) => ({
                value: category.id,
                label: `${category.icon} ${category.name}`
            })),
            selected
        );
        this.el.budgetCategory.disabled = false;
    }

    handleSaveTransaction() {
        if (!this.ensureAuthenticated()) return;

        const date = this.el.txDate.value;
        const type = this.el.txType.value;
        const amount = this.normalizeMoney(this.el.txAmount.value);
        const accountId = this.el.txAccount.value;
        const categoryId = this.el.txCategory.value;
        const note = this.el.txNote.value.trim().slice(0, 60);

        if (!date) {
            this.showToast("请选择流水日期", "error");
            return;
        }
        if (!(type === "income" || type === "expense")) {
            this.showToast("请选择流水类型", "error");
            return;
        }
        if (amount <= 0) {
            this.showToast("金额必须大于 0", "error");
            return;
        }

        const account = this.getAccountById(accountId);
        if (!account) {
            this.showToast("所选账户不存在", "error");
            return;
        }

        const category = this.getCategoryById(categoryId);
        if (!category || category.type !== type) {
            this.showToast("所选分类与流水类型不匹配", "error");
            return;
        }

        const now = new Date().toISOString();
        const isEditing = Boolean(this.currentEditingId);

        if (isEditing) {
            const index = this.data.transactions.findIndex((transaction) => transaction.id === this.currentEditingId);
            if (index < 0) {
                this.showToast("待编辑流水不存在", "error");
                this.resetTransactionForm(false);
                return;
            }
            const origin = this.data.transactions[index];
            this.data.transactions[index] = {
                ...origin,
                date,
                type,
                amount,
                accountId,
                categoryId,
                note,
                updatedAt: now
            };
        } else {
            this.data.transactions.push({
                id: this.generateId("tx"),
                date,
                type,
                amount,
                accountId,
                categoryId,
                note,
                createdAt: now,
                updatedAt: now
            });
        }

        this.sortTransactions();
        this.saveData();
        this.resetTransactionForm(false);
        this.renderAll();
        this.showToast(isEditing ? "流水已更新" : "流水已保存", "success");
    }

    resetTransactionForm(showMessage = false) {
        this.currentEditingId = null;
        this.el.transactionFormTitle.textContent = "新增流水";
        this.el.saveTxBtn.textContent = "保存流水";
        this.el.txDate.value = this.getCurrentDate();
        this.el.txType.value = "expense";
        this.el.txAmount.value = "";
        this.el.txNote.value = "";
        this.renderTransactionCategoryOptions();

        if (showMessage) {
            this.showToast("表单已重置", "success");
        }
    }

    editTransaction(transactionId) {
        if (!this.ensureAuthenticated()) return;
        const transaction = this.data.transactions.find((item) => item.id === transactionId);
        if (!transaction) {
            this.showToast("流水记录不存在", "error");
            return;
        }

        this.currentEditingId = transaction.id;
        this.switchTab("transactions");

        this.el.transactionFormTitle.textContent = "编辑流水";
        this.el.saveTxBtn.textContent = "更新流水";
        this.el.txDate.value = transaction.date;
        this.el.txType.value = transaction.type;
        this.renderTransactionCategoryOptions();
        this.el.txAccount.value = transaction.accountId;
        this.el.txCategory.value = transaction.categoryId;
        this.el.txAmount.value = String(transaction.amount);
        this.el.txNote.value = transaction.note || "";

        this.el.txAmount.focus();
        this.showToast("已载入流水，修改后点击“更新流水”", "success");
    }

    deleteTransaction(transactionId) {
        if (!this.ensureAuthenticated()) return;
        const transaction = this.data.transactions.find((item) => item.id === transactionId);
        if (!transaction) {
            this.showToast("流水记录不存在", "error");
            return;
        }

        const confirmed = window.confirm("确认删除这条流水吗？删除后不可恢复。");
        if (!confirmed) return;

        this.data.transactions = this.data.transactions.filter((item) => item.id !== transactionId);
        if (this.currentEditingId === transactionId) {
            this.resetTransactionForm(false);
        }

        this.saveData();
        this.renderAll();
        this.showToast("流水已删除", "success");
    }

    getFilteredTransactions() {
        const month = this.el.filterMonth.value;
        const type = this.el.filterType.value;
        const categoryId = this.el.filterCategory.value;
        const keyword = this.el.filterKeyword.value.trim().toLowerCase();

        return this.data.transactions.filter((transaction) => {
            if (month && this.getMonthKey(transaction.date) !== month) {
                return false;
            }
            if (type && transaction.type !== type) {
                return false;
            }
            if (categoryId && transaction.categoryId !== categoryId) {
                return false;
            }

            if (keyword) {
                const accountName = this.getAccountById(transaction.accountId)?.name || "";
                const categoryName = this.getCategoryById(transaction.categoryId)?.name || "";
                const source = `${transaction.note || ""} ${accountName} ${categoryName}`.toLowerCase();
                if (!source.includes(keyword)) {
                    return false;
                }
            }

            return true;
        });
    }

    renderTransactionsTable() {
        const list = this.getFilteredTransactions();
        const html = [];

        let incomeTotal = 0;
        let expenseTotal = 0;

        if (list.length === 0) {
            html.push(`
                <tr>
                    <td colspan="7">
                        <div class="empty-state">没有符合条件的流水记录</div>
                    </td>
                </tr>
            `);
        } else {
            list.forEach((transaction) => {
                const account = this.getAccountById(transaction.accountId);
                const category = this.getCategoryById(transaction.categoryId);
                const amountPrefix = transaction.type === "income" ? "+" : "-";
                const amountClass = transaction.type === "income" ? "amount-income" : "amount-expense";
                const typeClass = transaction.type === "income" ? "income" : "expense";
                const typeLabel = transaction.type === "income" ? "收入" : "支出";
                const note = transaction.note ? this.escapeHtml(transaction.note) : "-";
                const dateText = this.formatDate(transaction.date);

                if (transaction.type === "income") {
                    incomeTotal += transaction.amount;
                } else {
                    expenseTotal += transaction.amount;
                }

                html.push(`
                    <tr>
                        <td>${dateText}</td>
                        <td><span class="tag ${typeClass}">${typeLabel}</span></td>
                        <td>${this.escapeHtml(`${category?.icon || "📁"} ${category?.name || "未知分类"}`)}</td>
                        <td>${this.escapeHtml(`${account?.icon || "🏦"} ${account?.name || "未知账户"}`)}</td>
                        <td>${note}</td>
                        <td class="right ${amountClass}">${amountPrefix}${this.formatCurrency(transaction.amount)}</td>
                        <td class="right">
                            <button class="btn btn-link" data-action="edit" data-id="${transaction.id}">编辑</button>
                            <button class="btn btn-link danger" data-action="delete" data-id="${transaction.id}">删除</button>
                        </td>
                    </tr>
                `);
            });
        }

        this.el.transactionsTableBody.innerHTML = html.join("");
        this.el.filteredIncome.textContent = this.formatCurrency(incomeTotal);
        this.el.filteredExpense.textContent = this.formatCurrency(expenseTotal);

        const net = incomeTotal - expenseTotal;
        this.el.filteredNet.textContent = `${net >= 0 ? "+" : "-"}${this.formatCurrency(Math.abs(net))}`;
        this.el.filteredNet.classList.remove("amount-income", "amount-expense");
        this.el.filteredNet.classList.add(net >= 0 ? "amount-income" : "amount-expense");
    }

    renderOverview() {
        const month = this.el.overviewMonth.value || this.getCurrentMonth();
        this.el.overviewMonth.value = month;
        this.el.overviewMonthLabel.textContent = `${this.monthLabel(month)} 收支统计`;

        const monthlyStats = this.getMonthlyStats(month);
        const totalBalance = this.getTotalBalance();
        const savingRate = monthlyStats.income > 0 ? (monthlyStats.net / monthlyStats.income) * 100 : 0;

        this.el.statBalance.textContent = this.formatCurrency(totalBalance);
        this.el.statIncome.textContent = this.formatCurrency(monthlyStats.income);
        this.el.statExpense.textContent = this.formatCurrency(monthlyStats.expense);
        this.el.statSavingRate.textContent = `${savingRate.toFixed(1)}%`;
        this.el.statSavingRate.style.color = monthlyStats.net >= 0 ? "#15803d" : "#b91c1c";

        this.renderRecentTransactions();
        this.renderOverviewCharts();
    }

    renderRecentTransactions() {
        const recent = this.data.transactions.slice(0, 8);
        if (recent.length === 0) {
            this.el.recentTransactions.innerHTML = `
                <div class="empty-state">还没有任何流水，点击“+ 记一笔”开始记账。</div>
            `;
            return;
        }

        this.el.recentTransactions.innerHTML = recent
            .map((transaction) => {
                const account = this.getAccountById(transaction.accountId);
                const category = this.getCategoryById(transaction.categoryId);
                const amountClass = transaction.type === "income" ? "amount-income" : "amount-expense";
                const amountText = `${transaction.type === "income" ? "+" : "-"}${this.formatCurrency(transaction.amount)}`;
                const noteText = transaction.note ? ` · ${this.escapeHtml(transaction.note)}` : "";

                return `
                    <div class="recent-item">
                        <div class="recent-main">
                            <strong>${this.escapeHtml(`${category?.icon || "📁"} ${category?.name || "未知分类"}`)}</strong>
                            <small>${this.formatDate(transaction.date)} · ${this.escapeHtml(`${account?.icon || "🏦"} ${account?.name || "未知账户"}`)}${noteText}</small>
                        </div>
                        <strong class="${amountClass}">${amountText}</strong>
                    </div>
                `;
            })
            .join("");
    }

    renderOverviewCharts() {
        if (typeof Chart === "undefined") return;

        const month = this.el.overviewMonth.value || this.getCurrentMonth();
        this.renderTrendChart(month);
        this.renderExpenseCategoryChart(month);
        this.renderAccountBalanceChart();
    }

    renderTrendChart(month) {
        const months = this.getLastMonths(month, 6);
        const income = [];
        const expense = [];
        const net = [];

        months.forEach((monthKey) => {
            const stats = this.getMonthlyStats(monthKey);
            income.push(stats.income);
            expense.push(stats.expense);
            net.push(stats.net);
        });

        this.upsertChart("monthlyTrend", "monthlyTrendChart", {
            type: "line",
            data: {
                labels: months.map((monthKey) => monthKey.replace("-", "/")),
                datasets: [
                    {
                        label: "收入",
                        data: income,
                        borderColor: "#22c55e",
                        backgroundColor: "rgba(34, 197, 94, 0.12)",
                        borderWidth: 2,
                        tension: 0.35
                    },
                    {
                        label: "支出",
                        data: expense,
                        borderColor: "#ef4444",
                        backgroundColor: "rgba(239, 68, 68, 0.12)",
                        borderWidth: 2,
                        tension: 0.35
                    },
                    {
                        label: "净额",
                        data: net,
                        borderColor: "#6366f1",
                        backgroundColor: "rgba(99, 102, 241, 0.12)",
                        borderWidth: 2,
                        tension: 0.35
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" }
                },
                scales: {
                    y: {
                        ticks: {
                            callback: (value) => this.formatCurrency(Number(value))
                        }
                    }
                }
            }
        });
    }

    renderExpenseCategoryChart(month) {
        const monthTransactions = this.getMonthlyTransactions(month).filter(
            (transaction) => transaction.type === "expense"
        );

        const map = new Map();
        monthTransactions.forEach((transaction) => {
            map.set(transaction.categoryId, (map.get(transaction.categoryId) || 0) + transaction.amount);
        });

        const entries = Array.from(map.entries())
            .map(([categoryId, amount]) => {
                const category = this.getCategoryById(categoryId);
                return {
                    categoryId,
                    name: category?.name || "未知分类",
                    icon: category?.icon || "📁",
                    color: category?.color || "#94a3b8",
                    amount
                };
            })
            .sort((a, b) => b.amount - a.amount);

        const isEmpty = entries.length === 0;
        const labels = isEmpty ? ["暂无支出"] : entries.map((entry) => `${entry.icon} ${entry.name}`);
        const values = isEmpty ? [1] : entries.map((entry) => entry.amount);
        const colors = isEmpty ? ["#cbd5e1"] : entries.map((entry) => entry.color);
        const total = values.reduce((sum, value) => sum + value, 0);

        this.upsertChart("expenseCategory", "expenseCategoryChart", {
            type: "doughnut",
            data: {
                labels,
                datasets: [
                    {
                        data: values,
                        backgroundColor: colors,
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "bottom" },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                if (isEmpty) {
                                    return "暂无支出数据";
                                }
                                const value = Number(context.raw) || 0;
                                const ratio = total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
                                return `${context.label}: ${this.formatCurrency(value)} (${ratio}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    renderAccountBalanceChart() {
        const labels = this.data.accounts.map((account) => `${account.icon} ${account.name}`);
        const values = this.data.accounts.map((account) => this.getAccountBalance(account.id));
        const colors = this.data.accounts.map((account, index) => (values[index] >= 0 ? account.color : "#ef4444"));

        this.upsertChart("accountBalance", "accountBalanceChart", {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "余额",
                        data: values,
                        backgroundColor: colors,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        ticks: {
                            callback: (value) => this.formatCurrency(Number(value))
                        }
                    }
                }
            }
        });
    }

    upsertChart(name, canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || typeof Chart === "undefined") return;

        if (this.charts[name]) {
            this.charts[name].destroy();
        }

        this.charts[name] = new Chart(canvas.getContext("2d"), config);
    }

    handleSaveBudget() {
        if (!this.ensureAuthenticated()) return;

        const month = this.el.budgetMonth.value;
        const categoryId = this.el.budgetCategory.value;
        const amount = this.normalizeMoney(this.el.budgetAmount.value);

        if (!month) {
            this.showToast("请选择预算月份", "error");
            return;
        }
        if (!categoryId) {
            this.showToast("请选择支出分类", "error");
            return;
        }
        if (amount <= 0) {
            this.showToast("预算金额必须大于 0", "error");
            return;
        }

        const category = this.getCategoryById(categoryId);
        if (!category || category.type !== "expense") {
            this.showToast("预算分类无效", "error");
            return;
        }

        const now = new Date().toISOString();
        const existing = this.data.budgets.find(
            (budget) => budget.month === month && budget.categoryId === categoryId
        );

        if (existing) {
            existing.amount = amount;
            existing.updatedAt = now;
        } else {
            this.data.budgets.push({
                id: this.generateId("budget"),
                month,
                categoryId,
                amount,
                createdAt: now,
                updatedAt: now
            });
        }

        this.saveData();
        this.renderBudgetList();
        this.renderSystemInfo();
        this.el.budgetAmount.value = "";
        this.showToast("预算已保存", "success");
    }

    removeBudget(budgetId) {
        if (!this.ensureAuthenticated()) return;
        const target = this.data.budgets.find((budget) => budget.id === budgetId);
        if (!target) {
            this.showToast("预算记录不存在", "error");
            return;
        }

        if (!window.confirm("确认删除该预算吗？")) {
            return;
        }

        this.data.budgets = this.data.budgets.filter((budget) => budget.id !== budgetId);
        this.saveData();
        this.renderBudgetList();
        this.renderSystemInfo();
        this.showToast("预算已删除", "success");
    }

    renderBudgetList() {
        const month = this.el.budgetMonth.value || this.getCurrentMonth();
        this.el.budgetMonth.value = month;

        const budgets = this.data.budgets.filter((budget) => budget.month === month);
        if (budgets.length === 0) {
            this.el.budgetSummaryText.textContent = `${this.monthLabel(month)}：尚未设置预算`;
            this.el.budgetList.innerHTML = `<div class="empty-state">暂无预算，先新增一条预算吧。</div>`;
            return;
        }

        const monthExpenseMap = new Map();
        this.getMonthlyTransactions(month)
            .filter((transaction) => transaction.type === "expense")
            .forEach((transaction) => {
                monthExpenseMap.set(
                    transaction.categoryId,
                    (monthExpenseMap.get(transaction.categoryId) || 0) + transaction.amount
                );
            });

        let totalBudget = 0;
        let totalSpent = 0;
        const rows = budgets
            .map((budget) => {
                const category = this.getCategoryById(budget.categoryId);
                const spent = monthExpenseMap.get(budget.categoryId) || 0;
                const remaining = budget.amount - spent;
                const ratio = budget.amount > 0 ? spent / budget.amount : 0;
                const progressPercent = Math.min(ratio, 1) * 100;

                totalBudget += budget.amount;
                totalSpent += spent;

                let progressClass = "";
                if (ratio > 1) progressClass = "over";
                else if (ratio >= 0.8) progressClass = "warn";

                return {
                    id: budget.id,
                    html: `
                        <div class="budget-item">
                            <div class="budget-top">
                                <strong>${this.escapeHtml(`${category?.icon || "📁"} ${category?.name || "未知分类"}`)}</strong>
                                <button class="btn btn-link danger" data-action="remove-budget" data-id="${budget.id}">删除</button>
                            </div>
                            <div class="budget-meta">
                                预算 ${this.formatCurrency(budget.amount)} · 已用 ${this.formatCurrency(spent)} ·
                                <span class="${remaining >= 0 ? "amount-income" : "amount-expense"}">
                                    ${remaining >= 0 ? "剩余" : "超支"} ${this.formatCurrency(Math.abs(remaining))}
                                </span>
                            </div>
                            <div class="progress-track">
                                <div class="progress-fill ${progressClass}" style="width: ${progressPercent.toFixed(1)}%;"></div>
                            </div>
                        </div>
                    `
                };
            })
            .sort((a, b) => b.id.localeCompare(a.id));

        const totalRemaining = totalBudget - totalSpent;
        this.el.budgetSummaryText.textContent =
            `${this.monthLabel(month)}：预算 ${this.formatCurrency(totalBudget)}，` +
            `已花费 ${this.formatCurrency(totalSpent)}，` +
            `${totalRemaining >= 0 ? "剩余" : "超支"} ${this.formatCurrency(Math.abs(totalRemaining))}`;
        this.el.budgetList.innerHTML = rows.map((row) => row.html).join("");
    }

    renderSettingsLists() {
        this.renderAccountList();
        this.renderCategoryList();
    }

    renderAccountList() {
        if (this.data.accounts.length === 0) {
            this.el.accountList.innerHTML = `<div class="empty-state">暂无账户</div>`;
            return;
        }

        this.el.accountList.innerHTML = this.data.accounts
            .map((account) => {
                const currentBalance = this.getAccountBalance(account.id);
                const action = account.isDefault
                    ? `<span class="meta">默认账户</span>`
                    : `<button class="btn btn-link danger" data-action="remove-account" data-id="${account.id}">删除</button>`;
                return `
                    <div class="settings-item">
                        <div>
                            <strong>${this.escapeHtml(`${account.icon} ${account.name}`)}</strong>
                            <div class="meta">初始余额 ${this.formatCurrency(account.initialBalance)} · 当前余额 ${this.formatCurrency(currentBalance)}</div>
                        </div>
                        ${action}
                    </div>
                `;
            })
            .join("");
    }

    renderCategoryList() {
        if (this.data.categories.length === 0) {
            this.el.categoryList.innerHTML = `<div class="empty-state">暂无分类</div>`;
            return;
        }

        this.el.categoryList.innerHTML = this.data.categories
            .map((category) => {
                const typeText = category.type === "income" ? "收入分类" : "支出分类";
                const action = category.isDefault
                    ? `<span class="meta">默认分类</span>`
                    : `<button class="btn btn-link danger" data-action="remove-category" data-id="${category.id}">删除</button>`;
                return `
                    <div class="settings-item">
                        <div>
                            <strong>${this.escapeHtml(`${category.icon} ${category.name}`)}</strong>
                            <div class="meta">${typeText}</div>
                        </div>
                        ${action}
                    </div>
                `;
            })
            .join("");
    }

    addAccount() {
        if (!this.ensureAuthenticated()) return;
        const name = this.el.newAccountName.value.trim();
        const icon = this.el.newAccountIcon.value.trim() || "🏦";
        const color = this.el.newAccountColor.value || "#6366f1";
        const initialBalance = this.normalizeMoney(this.el.newAccountInitialBalance.value);

        if (!name) {
            this.showToast("请输入账户名称", "error");
            return;
        }

        const exists = this.data.accounts.some(
            (account) => account.name.toLowerCase() === name.toLowerCase()
        );
        if (exists) {
            this.showToast("账户名称已存在", "error");
            return;
        }

        this.data.accounts.push({
            id: this.generateId("acc"),
            name,
            icon,
            color,
            initialBalance,
            isDefault: false
        });

        this.saveData();
        this.renderAll();

        this.el.newAccountName.value = "";
        this.el.newAccountIcon.value = "";
        this.el.newAccountInitialBalance.value = "0";
        this.showToast("账户新增成功", "success");
    }

    removeAccount(accountId) {
        if (!this.ensureAuthenticated()) return;
        const account = this.getAccountById(accountId);
        if (!account) {
            this.showToast("账户不存在", "error");
            return;
        }
        if (account.isDefault) {
            this.showToast("默认账户不可删除", "error");
            return;
        }
        const used = this.data.transactions.some((transaction) => transaction.accountId === accountId);
        if (used) {
            this.showToast("该账户已被流水使用，无法删除", "error");
            return;
        }

        if (!window.confirm(`确认删除账户「${account.name}」吗？`)) {
            return;
        }

        this.data.accounts = this.data.accounts.filter((item) => item.id !== accountId);
        this.saveData();
        this.renderAll();
        this.showToast("账户已删除", "success");
    }

    addCategory() {
        if (!this.ensureAuthenticated()) return;
        const name = this.el.newCategoryName.value.trim();
        const type = this.el.newCategoryType.value;
        const icon = this.el.newCategoryIcon.value.trim() || (type === "income" ? "💰" : "🧾");
        const color = this.el.newCategoryColor.value || (type === "income" ? "#22c55e" : "#f97316");

        if (!name) {
            this.showToast("请输入分类名称", "error");
            return;
        }

        const exists = this.data.categories.some(
            (category) => category.name.toLowerCase() === name.toLowerCase() && category.type === type
        );
        if (exists) {
            this.showToast("同类型分类名称已存在", "error");
            return;
        }

        this.data.categories.push({
            id: this.generateId("cat"),
            name,
            type: type === "income" ? "income" : "expense",
            icon,
            color,
            isDefault: false
        });

        this.saveData();
        this.renderAll();

        this.el.newCategoryName.value = "";
        this.el.newCategoryIcon.value = "";
        this.showToast("分类新增成功", "success");
    }

    removeCategory(categoryId) {
        if (!this.ensureAuthenticated()) return;
        const category = this.getCategoryById(categoryId);
        if (!category) {
            this.showToast("分类不存在", "error");
            return;
        }
        if (category.isDefault) {
            this.showToast("默认分类不可删除", "error");
            return;
        }

        const usedByTransactions = this.data.transactions.some(
            (transaction) => transaction.categoryId === categoryId
        );
        if (usedByTransactions) {
            this.showToast("该分类已被流水使用，无法删除", "error");
            return;
        }

        const usedByBudgets = this.data.budgets.some((budget) => budget.categoryId === categoryId);
        if (usedByBudgets) {
            this.showToast("该分类已被预算使用，无法删除", "error");
            return;
        }

        if (!window.confirm(`确认删除分类「${category.name}」吗？`)) {
            return;
        }

        this.data.categories = this.data.categories.filter((item) => item.id !== categoryId);
        this.saveData();
        this.renderAll();
        this.showToast("分类已删除", "success");
    }

    exportData() {
        if (!this.ensureAuthenticated()) return;
        const exportedAt = new Date().toISOString();
        const payload = {
            ...this.data,
            exportedAt,
            userEmail: this.user?.email || ""
        };
        const dataText = JSON.stringify(payload, null, 2);
        const blob = new Blob([dataText], { type: "application/json" });
        const link = document.createElement("a");
        const stamp = exportedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "_");

        link.href = URL.createObjectURL(blob);
        link.download = `bookkeeping-backup-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        localStorage.setItem(LAST_EXPORT_KEY, exportedAt);
        this.renderSystemInfo();
        this.showToast("数据导出成功", "success");
    }

    triggerImport() {
        if (!this.ensureAuthenticated()) return;
        this.el.importFileInput.value = "";
        this.el.importFileInput.click();
    }

    importDataFromFile(event) {
        if (!this.ensureAuthenticated()) {
            event.target.value = "";
            return;
        }

        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            try {
                const parsed = JSON.parse(loadEvent.target.result);
                if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.transactions)) {
                    this.showToast("导入失败：文件结构不正确", "error");
                    return;
                }

                if (!window.confirm("导入会覆盖当前数据，确定继续吗？")) {
                    return;
                }

                this.data = this.normalizeData(parsed);
                this.sortTransactions();
                this.saveData({ immediate: true });
                this.bootstrapDefaults();
                this.resetTransactionForm(false);
                this.renderAll();
                this.showToast("数据导入成功", "success");
            } catch (error) {
                console.error(error);
                this.showToast("导入失败：JSON 格式错误", "error");
            }
        };

        reader.onerror = () => {
            this.showToast("导入失败：文件读取错误", "error");
        };

        reader.readAsText(file);
        event.target.value = "";
    }

    clearAllData() {
        if (!this.ensureAuthenticated()) return;
        const step1 = window.confirm("确认清空所有数据吗？此操作不可恢复。");
        if (!step1) return;

        const step2 = window.confirm("请再次确认：真的要删除全部流水、预算、账户和分类吗？");
        if (!step2) return;

        this.data = this.buildDefaultData();
        this.saveData({ immediate: true });
        this.bootstrapDefaults();
        this.resetTransactionForm(false);
        this.renderAll();
        this.showToast("所有数据已清空", "success");
    }

    renderSystemInfo() {
        const transactionCount = this.data.transactions.length;
        const budgetCount = this.data.budgets.length;
        const accountCount = this.data.accounts.length;
        const categoryCount = this.data.categories.length;
        const latestTransaction = this.data.transactions[0]?.date || "-";
        const lastUpdate = this.data.meta?.updatedAt
            ? new Date(this.data.meta.updatedAt).toLocaleString("zh-CN")
            : "-";
        const userEmail = this.user?.email || "未登录";

        this.el.dataStats.innerHTML = `
            <div>当前用户：${this.escapeHtml(userEmail)}</div>
            <div>流水条数：${transactionCount}</div>
            <div>预算条数：${budgetCount}</div>
            <div>账户数量：${accountCount}</div>
            <div>分类数量：${categoryCount}</div>
            <div>最近一笔：${latestTransaction}</div>
            <div>最后更新：${lastUpdate}</div>
            <div>存储位置：Supabase 云端 + 浏览器缓存</div>
        `;

        const lastBackup = localStorage.getItem(LAST_EXPORT_KEY);
        this.el.lastBackupTime.textContent = lastBackup
            ? new Date(lastBackup).toLocaleString("zh-CN")
            : "-";
    }

    getAccountById(accountId) {
        return this.data.accounts.find((account) => account.id === accountId);
    }

    getCategoryById(categoryId) {
        return this.data.categories.find((category) => category.id === categoryId);
    }

    getMonthlyTransactions(month) {
        if (!month) {
            return [...this.data.transactions];
        }
        return this.data.transactions.filter((transaction) => this.getMonthKey(transaction.date) === month);
    }

    getMonthlyStats(month) {
        const list = this.getMonthlyTransactions(month);
        let income = 0;
        let expense = 0;

        list.forEach((transaction) => {
            if (transaction.type === "income") {
                income += transaction.amount;
            } else {
                expense += transaction.amount;
            }
        });

        return {
            income: this.normalizeMoney(income),
            expense: this.normalizeMoney(expense),
            net: this.normalizeMoney(income - expense)
        };
    }

    getTotalBalance() {
        const initial = this.data.accounts.reduce(
            (sum, account) => sum + this.normalizeMoney(account.initialBalance),
            0
        );
        const flow = this.data.transactions.reduce(
            (sum, transaction) => sum + this.getTransactionSignedAmount(transaction),
            0
        );
        return this.normalizeMoney(initial + flow);
    }

    getAccountBalance(accountId) {
        const account = this.getAccountById(accountId);
        if (!account) return 0;

        const flow = this.data.transactions
            .filter((transaction) => transaction.accountId === accountId)
            .reduce((sum, transaction) => sum + this.getTransactionSignedAmount(transaction), 0);

        return this.normalizeMoney(account.initialBalance + flow);
    }

    getTransactionSignedAmount(transaction) {
        return transaction.type === "income" ? transaction.amount : -transaction.amount;
    }

    sortTransactions() {
        this.data.transactions.sort((a, b) => {
            const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
            if (dateDiff !== 0) return dateDiff;
            const updatedA = new Date(a.updatedAt || a.createdAt || 0).getTime();
            const updatedB = new Date(b.updatedAt || b.createdAt || 0).getTime();
            return updatedB - updatedA;
        });
    }

    showToast(message, type = "success") {
        if (!this.el.toast) return;
        this.el.toast.textContent = message;
        this.el.toast.className = `toast show ${type}`;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.el.toast.className = "toast";
        }, 2400);
    }

    formatCurrency(value) {
        return this.currencyFormatter.format(Number(value) || 0);
    }

    formatDate(dateString) {
        if (!dateString) return "-";
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return dateString;
        return date.toLocaleDateString("zh-CN");
    }

    monthLabel(monthKey) {
        if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
        const [year, month] = monthKey.split("-");
        return `${year} 年 ${Number(month)} 月`;
    }

    getCurrentDate() {
        const now = new Date();
        const timezoneOffset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
    }

    getCurrentMonth() {
        return this.getCurrentDate().slice(0, 7);
    }

    getMonthKey(dateString) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return dateString.slice(0, 7);
        }
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    getLastMonths(endMonth, count = 6) {
        const [year, month] = endMonth.split("-").map(Number);
        const base = new Date(year, month - 1, 1);
        const result = [];

        for (let index = count - 1; index >= 0; index -= 1) {
            const date = new Date(base.getFullYear(), base.getMonth() - index, 1);
            result.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
        }
        return result;
    }

    normalizeMoney(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.round(number * 100) / 100;
    }

    generateId(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    window.app = new WebBookkeepingApp();
    await window.app.init();
});
