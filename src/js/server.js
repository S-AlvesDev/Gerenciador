require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// Import database connection and models
const connectDB = require('../config/database');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/css', express.static('src/css'));
app.set('view engine', 'ejs');
app.set('views', './views');

// Configuração da sessão com MongoDB
app.use(session({
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 30 * 24 * 60 * 60 // 30 dias em segundos
    }),
    secret: process.env.SESSION_SECRET || 'your_session_secret_here',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
    }
}));

// Configuração do Multer para upload de arquivos (memória para Vercel)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Inicialização do banco de dados
async function initializeDatabase() {
    try {
        // Criar tabela de sessões
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
            );
        `);

        // Criar tabela de usuários
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                verification_token VARCHAR(255),
                reset_token VARCHAR(255),
                reset_token_expires TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Criar tabela de transações
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                type VARCHAR(10) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                description TEXT,
                category VARCHAR(50),
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                receipt_path VARCHAR(255)
            );
        `);

        // Criar tabela de orçamentos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS budgets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                category VARCHAR(50) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                month INTEGER NOT NULL,
                year INTEGER NOT NULL,
                UNIQUE(user_id, category, month, year)
            );
        `);

        console.log('Banco de dados inicializado com sucesso');
    } catch (error) {
        console.error('Erro ao inicializar banco de dados:', error);
    }
}

// Middleware de autenticação
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Rotas
app.get('/', (req, res) => {
    res.render('login');
});

app.get('/login', (req, res) => {
    const messages = {};
    if (req.query.verification_pending === 'true') {
        messages.success = 'Registro realizado! Por favor, verifique seu email para ativar sua conta.';
    }
    res.render('login', { messages });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (user && await bcrypt.compare(password, user.password)) {
            if (!user.verified) {
                return res.render('login', { 
                    messages: { 
                        error: 'Por favor, verifique seu email antes de fazer login' 
                    } 
                });
            }

            req.session.userId = user.id;
            res.redirect('/dashboard');
        } else {
            res.render('login', { 
                messages: { 
                    error: 'Email ou senha incorretos' 
                } 
            });
        }
    } catch (error) {
        console.error('Erro no login:', error);
        res.render('login', { 
            messages: { 
                error: 'Erro ao fazer login' 
            } 
        });
    }
});

app.get('/register', (req, res) => {
    res.render('register', { messages: {} });
});

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    try {
        // Verificar se o email já existe
        const existingUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.render('register', { 
                messages: { 
                    error: 'Este email já está registrado' 
                } 
            });
        }

        // Criar hash da senha
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Gerar token de verificação
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Inserir usuário
        await pool.query(
            'INSERT INTO users (name, email, password, verification_token) VALUES ($1, $2, $3, $4)',
            [name, email, hashedPassword, verificationToken]
        );

        // Enviar email de verificação
        const verificationLink = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verifique seu email - Gestão Financeira',
            html: `
                <h1>Bem-vindo ao Gestão Financeira!</h1>
                <p>Por favor, clique no link abaixo para verificar seu email:</p>
                <a href="${verificationLink}">${verificationLink}</a>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.render('login', { 
            messages: { 
                success: 'Registro realizado! Por favor, verifique seu email para ativar sua conta.',
                showResend: true
            } 
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.render('register', { 
            messages: { 
                error: 'Erro ao registrar usuário' 
            } 
        });
    }
});

// Rota para verificação de email
app.get('/verify/:token', (req, res) => {
    const { token } = req.params;
    
    pool.query('UPDATE users SET verified = TRUE WHERE verification_token = $1', [token], function(err, result) {
        if (err) {
            return res.render('login', { messages: { error: 'Erro ao verificar email' } });
        }
        
        if (result.rowCount > 0) {
            res.render('login', { messages: { success: 'Email verificado com sucesso! Você já pode fazer login.' } });
        } else {
            res.render('login', { messages: { error: 'Token de verificação inválido' } });
        }
    });
});

app.get('/dashboard', requireLogin, (req, res) => {
    const userId = req.session.userId;
    
    // Obter todas as transações do usuário
    pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC', [userId], (err, result) => {
        if (err) {
            console.error('Erro ao buscar transações:', err);
            return res.render('dashboard', { 
                user: req.session.user,
                totalBalance: 0,
                monthlyIncome: 0,
                monthlyExpenses: 0,
                transactions: [],
                expenseCategories: [],
                expenseAmounts: [],
                monthlyLabels: [],
                monthlyIncomeData: [],
                monthlyExpenseData: [],
                error: 'Erro ao carregar dados'
            });
        }

        const transactions = result.rows;

        // Calcular saldo total e valores mensais
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        let totalBalance = 0;
        let monthlyIncome = 0;
        let monthlyExpenses = 0;
        
        // Para o gráfico de categorias
        const expensesByCategory = {};
        
        // Para o gráfico mensal
        const monthlyData = {};
        
        transactions.forEach(transaction => {
            const amount = parseFloat(transaction.amount);
            const transactionDate = new Date(transaction.date);
            const monthKey = `${transactionDate.getFullYear()}-${(transactionDate.getMonth() + 1).toString().padStart(2, '0')}`;
            
            // Inicializar dados mensais se não existirem
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = { income: 0, expenses: 0 };
            }
            
            // Atualizar saldo total e dados mensais
            if (transaction.type === 'INCOME') {
                totalBalance += amount;
                monthlyData[monthKey].income += amount;
                // Se for deste mês, adicionar à receita mensal
                if (transactionDate >= firstDayOfMonth) {
                    monthlyIncome += amount;
                }
            } else if (transaction.type === 'EXPENSE') {
                totalBalance -= amount;
                monthlyData[monthKey].expenses += amount;
                // Se for deste mês, adicionar à despesa mensal
                if (transactionDate >= firstDayOfMonth) {
                    monthlyExpenses += amount;
                }
                // Adicionar à categoria de despesas
                if (!expensesByCategory[transaction.category]) {
                    expensesByCategory[transaction.category] = 0;
                }
                expensesByCategory[transaction.category] += amount;
            }
        });

        // Preparar dados para os gráficos
        const expenseCategories = Object.keys(expensesByCategory);
        const expenseAmounts = expenseCategories.map(category => expensesByCategory[category]);

        // Preparar dados mensais (últimos 6 meses)
        const sortedMonths = Object.keys(monthlyData).sort().slice(-6);
        const monthlyLabels = sortedMonths.map(month => {
            const [year, monthNum] = month.split('-');
            return `${monthNum}/${year}`;
        });
        const monthlyIncomeData = sortedMonths.map(month => monthlyData[month].income);
        const monthlyExpenseData = sortedMonths.map(month => monthlyData[month].expenses);

        // Renderizar dashboard com todos os dados
        res.render('dashboard', {
            user: req.session.user,
            totalBalance: totalBalance.toFixed(2),
            monthlyIncome: monthlyIncome.toFixed(2),
            monthlyExpenses: monthlyExpenses.toFixed(2),
            transactions: transactions.slice(0, 5), // Últimas 5 transações
            expenseCategories,
            expenseAmounts,
            monthlyLabels,
            monthlyIncomeData,
            monthlyExpenseData,
            error: null
        });
    });
});

// Rota para reenviar email de verificação
app.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    
    pool.query('SELECT * FROM users WHERE email = $1', [email], async (err, result) => {
        if (err || result.rows.length === 0) {
            return res.json({ 
                success: false, 
                message: 'Email não encontrado' 
            });
        }
        
        const user = result.rows[0];
        
        if (user.verified) {
            return res.json({ 
                success: false, 
                message: 'Este email já está verificado' 
            });
        }
        
        // Gerar novo token de verificação
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Atualizar token no banco
        await pool.query('UPDATE users SET verification_token = $1 WHERE email = $2', [verificationToken, email]);
        
        // Enviar email de verificação
        const verificationLink = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
        const emailHtml = `
            <h1>Verificação de Email - Gestão Financeira</h1>
            <p>Olá ${user.name},</p>
            <p>Por favor, clique no link abaixo para verificar seu email:</p>
            <a href="${verificationLink}">${verificationLink}</a>
            <p>Se você não solicitou este email, por favor ignore.</p>
        `;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verificação de Email - Gestão Financeira',
            html: emailHtml
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Email de verificação reenviado com sucesso' 
        });
    });
});

// Rota para adicionar transação
app.post('/transaction/add', requireLogin, upload.single('receipt'), (req, res) => {
    const userId = req.session.userId;
    const { type, amount, description, category, recurring, recurrencePeriod } = req.body;
    const date = new Date().toISOString();
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Validar dados
    if (!type || !amount || !description || !category) {
        return res.status(400).json({ 
            success: false, 
            message: 'Todos os campos obrigatórios devem ser preenchidos' 
        });
    }

    // Inserir transação no banco de dados
    pool.query(
        'INSERT INTO transactions (user_id, type, amount, description, category, date, receipt_path) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
            userId,
            type,
            amount,
            description,
            category,
            date,
            receiptUrl
        ],
        function(err, result) {
            if (err) {
                console.error('Erro ao adicionar transação:', err);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Erro ao adicionar transação' 
                });
            }

            // Se for uma transação recorrente, agendar próximas ocorrências
            if (recurring === 'on') {
                // Aqui você pode implementar a lógica para transações recorrentes
                // Por exemplo, criar transações futuras com base no período
            }

            // Redirecionar para o dashboard com mensagem de sucesso
            res.redirect('/dashboard?success=true');
        }
    );
});

// Rota para criar conta de teste (já verificada)
app.get('/create-test-account', (req, res) => {
    const testUser = {
        name: 'Usuário Teste',
        email: 'teste@teste.com',
        password: '123456'
    };
    
    // Primeiro, verificar se a conta já existe
    pool.query('SELECT * FROM users WHERE email = $1', [testUser.email], async (err, result) => {
        if (err) {
            console.error('Erro ao verificar usuário:', err);
            return res.send('Erro ao verificar se a conta existe.');
        }
        
        if (result.rows.length > 0) {
            // Se a conta existe, apenas mostrar as credenciais
            return res.send(`
                <h1>Conta de teste já existe!</h1>
                <p>Use estas credenciais para fazer login:</p>
                <p>Email: ${testUser.email}</p>
                <p>Senha: ${testUser.password}</p>
                <p><a href="/login">Ir para o login</a></p>
            `);
        }
        
        // Se não existe, criar nova conta
        const hashedPassword = await bcrypt.hash(testUser.password, 10);
        
        pool.query(
            'INSERT INTO users (name, email, password, verified) VALUES ($1, $2, $3, TRUE)',
            [testUser.name, testUser.email, hashedPassword],
            function(err, result) {
                if (err) {
                    console.error('Erro ao criar conta:', err);
                    return res.send('Erro ao criar conta de teste.');
                }
                
                res.send(`
                    <h1>Conta de teste criada com sucesso!</h1>
                    <p>Use estas credenciais para fazer login:</p>
                    <p>Email: ${testUser.email}</p>
                    <p>Senha: ${testUser.password}</p>
                    <p><a href="/login">Ir para o login</a></p>
                `);
            }
        );
    });
});

// Rota para página de recuperação de senha
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { messages: {} });
});

// Rota para solicitar recuperação de senha
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    pool.query('SELECT * FROM users WHERE email = $1', [email], async (err, result) => {
        if (err || result.rows.length === 0) {
            return res.render('forgot-password', { 
                messages: { error: 'Email não encontrado' }
            });
        }
        
        const user = result.rows[0];
        
        // Gerar token de recuperação
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // Salvar token no banco
        await pool.query('UPDATE users SET reset_token = $1, reset_token_expires = CURRENT_TIMESTAMP + INTERVAL \'1 hour\' WHERE email = $2', [resetToken, email]);
        
        // Enviar email com link de recuperação
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
        const emailHtml = `
            <h1>Recuperação de Senha - Gestão Financeira</h1>
            <p>Olá ${user.name},</p>
            <p>Você solicitou a recuperação de senha. Clique no link abaixo para redefinir sua senha:</p>
            <a href="${resetLink}">${resetLink}</a>
            <p>Se você não solicitou a recuperação de senha, por favor ignore este email.</p>
            <p>Este link expira em 1 hora.</p>
        `;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Recuperação de Senha - Gestão Financeira',
            html: emailHtml
        };
        
        await transporter.sendMail(mailOptions);
        
        res.render('forgot-password', { 
            messages: { 
                success: 'Email de recuperação enviado. Por favor, verifique sua caixa de entrada.' 
            }
        });
    });
});

// Rota para página de redefinição de senha
app.get('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    
    // Verificar se o token existe e não expirou (1 hora de validade)
    const oneHourAgo = new Date(Date.now() - 3600000); // 1 hora atrás
    
    pool.query(
        'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > CURRENT_TIMESTAMP',
        [token],
        (err, result) => {
            if (err || result.rows.length === 0) {
                return res.render('login', { 
                    messages: { error: 'Link de recuperação inválido ou expirado' }
                });
            }
            
            res.render('reset-password', { token, messages: {} });
        }
    );
});

// Rota para processar redefinição de senha
app.post('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
        return res.render('reset-password', { 
            token,
            messages: { error: 'As senhas não coincidem' }
        });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    pool.query(
        'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $2',
        [hashedPassword, token],
        function(err, result) {
            if (err || result.rowCount === 0) {
                return res.render('reset-password', { 
                    token,
                    messages: { error: 'Erro ao redefinir senha' }
                });
            }
            
            res.render('login', { 
                messages: { success: 'Senha redefinida com sucesso! Você já pode fazer login.' }
            });
        }
    );
});

// Rota de logout
app.get('/logout', (req, res) => {
    // Destruir a sessão
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao fazer logout:', err);
        }
        // Redirecionar para a página de login
        res.redirect('/login');
    });
});

// Inicializar banco de dados e iniciar servidor
initializeDatabase().then(() => {
    app.listen(port, () => {
        console.log(`Servidor rodando em http://localhost:${port}`);
    });
}); 