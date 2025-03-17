require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// Import database connection and models
const connectDB = require('../config/database');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const app = express();
const port = process.env.PORT || 3000;

// Configurar diretórios absolutos
const rootDir = path.resolve(__dirname, '../..');
const viewsDir = path.join(rootDir, 'views');
const publicDir = path.join(rootDir, 'public');
const cssDir = path.join(rootDir, 'src/css');

// Configurações básicas do Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));
app.use('/css', express.static(cssDir));
app.set('view engine', 'ejs');
app.set('views', viewsDir);

// Inicializar conexão com MongoDB
let mongoStore;

(async () => {
    try {
        await connectDB();
        console.log('MongoDB conectado inicialmente');
        
        // Configurar session store após conexão bem-sucedida
        mongoStore = MongoStore.create({
            mongoUrl: process.env.MONGODB_URI,
            ttl: 30 * 24 * 60 * 60 // 30 dias em segundos
        });

        // Configurar sessão
        app.use(session({
            store: mongoStore,
            secret: process.env.SESSION_SECRET || 'your_session_secret_here',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
            }
        }));

        // Iniciar servidor após configuração bem-sucedida
        app.listen(port, () => {
            console.log(`Servidor rodando na porta ${port}`);
        });
    } catch (error) {
        console.error('Erro na inicialização:', error);
    }
})();

// Middleware para verificar conexão MongoDB
app.use(async (req, res, next) => {
    try {
        if (!mongoStore) {
            throw new Error('MongoDB store não está inicializado');
        }
        await connectDB();
        next();
    } catch (error) {
        console.error('Erro de conexão MongoDB:', error);
        return res.status(500).render('error', {
            error: 'Erro ao conectar ao banco de dados. Por favor, tente novamente.'
        });
    }
});

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

// Middleware de autenticação
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    
    if (err.name === 'TimeoutError') {
        return res.status(504).render('error', {
            error: 'A operação demorou muito tempo. Por favor, tente novamente.'
        });
    }
    
    if (err.name === 'MongoError' || err.name === 'MongooseError') {
        return res.status(500).render('error', {
            error: 'Erro de conexão com o banco de dados. Por favor, tente novamente.'
        });
    }
    
    res.status(500).render('error', { 
        error: process.env.NODE_ENV === 'production' 
            ? 'Ocorreu um erro interno no servidor.' 
            : err.message 
    });
});

// Rotas
app.get('/', (req, res) => {
    try {
        res.render('login', { messages: {} });
    } catch (error) {
        console.error('Erro ao renderizar página de login:', error);
        res.status(500).send('Erro ao carregar a página');
    }
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
        const user = await User.findOne({ email });

        if (user && await bcrypt.compare(password, user.password)) {
            if (!user.verified) {
                return res.render('login', { 
                    messages: { 
                        error: 'Por favor, verifique seu email antes de fazer login' 
                    } 
                });
            }

            req.session.userId = user._id;
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
        const existingUser = await User.findOne({ email }).lean();
        if (existingUser) {
            return res.render('register', { 
                messages: { 
                    error: 'Este email já está registrado' 
                } 
            });
        }

        // Criar hash da senha com menos rounds para ser mais rápido
        const hashedPassword = await bcrypt.hash(password, 8);
        
        // Gerar token de verificação
        const verificationToken = crypto.randomBytes(16).toString('hex');

        // Criar novo usuário
        const user = new User({
            name,
            email,
            password: hashedPassword,
            verificationToken,
            verified: false
        });

        // Salvar usuário
        await user.save();

        // Enviar para página de sucesso imediatamente
        res.render('login', { 
            messages: { 
                success: 'Registro realizado! Por favor, verifique seu email para ativar sua conta.',
                showResend: true
            } 
        });

        // Enviar email de verificação em background
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

        transporter.sendMail(mailOptions).catch(err => {
            console.error('Erro ao enviar email de verificação:', err);
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
app.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        const user = await User.findOneAndUpdate(
            { verificationToken: token },
            { 
                $set: { verified: true },
                $unset: { verificationToken: "" }
            }
        );

        if (!user) {
            return res.render('login', { messages: { error: 'Token de verificação inválido' } });
        }

        res.render('login', { messages: { success: 'Email verificado com sucesso! Você já pode fazer login.' } });
    } catch (error) {
        console.error('Erro ao verificar email:', error);
        res.render('login', { messages: { error: 'Erro ao verificar email' } });
    }
});

app.get('/dashboard', requireLogin, (req, res) => {
    const userId = req.session.userId;
    
    // Obter todas as transações do usuário
    Transaction.find({ user_id: userId })
        .sort({ date: -1 })
        .limit(5)
        .exec((err, transactions) => {
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
                transactions: transactions,
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
    
    try {
        const user = await User.findOne({ email });
        
        if (!user || user.verified) {
            return res.json({ 
                success: false, 
                message: 'Este email já está verificado' 
            });
        }
        
        // Gerar novo token de verificação
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Atualizar token no banco
        user.verificationToken = verificationToken;
        await user.save();
        
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
    } catch (error) {
        console.error('Erro ao reenviar email de verificação:', error);
        res.json({ 
            success: false, 
            message: 'Erro ao reenviar email de verificação' 
        });
    }
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
    const transaction = new Transaction({
        user_id: userId,
        type,
        amount,
        description,
        category,
        date,
        receipt_path: receiptUrl
    });

    transaction.save((err, result) => {
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
    });
});

// Rota para criar conta de teste (já verificada)
app.get('/create-test-account', (req, res) => {
    const testUser = {
        name: 'Usuário Teste',
        email: 'teste@teste.com',
        password: '123456'
    };
    
    // Primeiro, verificar se a conta já existe
    User.findOne({ email: testUser.email }, (err, existingUser) => {
        if (err) {
            console.error('Erro ao verificar usuário:', err);
            return res.send('Erro ao verificar se a conta existe.');
        }
        
        if (existingUser) {
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
        const hashedPassword = bcrypt.hashSync(testUser.password, 10);
        
        const user = new User({
            name: testUser.name,
            email: testUser.email,
            password: hashedPassword,
            verified: true
        });

        user.save((err, result) => {
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
        });
    });
});

// Rota para página de recuperação de senha
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { messages: {} });
});

// Rota para solicitar recuperação de senha
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await User.findOne({ email }).lean();
        
        if (!user) {
            return res.render('forgot-password', { 
                messages: { error: 'Email não encontrado' }
            });
        }
        
        // Gerar token de recuperação menor
        const resetToken = crypto.randomBytes(16).toString('hex');
        
        // Salvar token no banco
        await User.updateOne(
            { _id: user._id },
            {
                reset_token: resetToken,
                reset_token_expires: new Date(Date.now() + 3600000) // 1 hora
            }
        );
        
        // Enviar resposta imediatamente
        res.render('forgot-password', { 
            messages: { 
                success: 'Email de recuperação enviado. Por favor, verifique sua caixa de entrada.' 
            }
        });

        // Enviar email em background
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
        
        transporter.sendMail(mailOptions).catch(err => {
            console.error('Erro ao enviar email de recuperação:', err);
        });
        
    } catch (error) {
        console.error('Erro ao solicitar recuperação de senha:', error);
        res.render('forgot-password', { 
            messages: { 
                error: 'Erro ao solicitar recuperação de senha' 
            }
        });
    }
});

// Rota para página de redefinição de senha
app.get('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    
    // Verificar se o token existe e não expirou (1 hora de validade)
    const oneHourAgo = new Date(Date.now() - 3600000); // 1 hora atrás
    
    User.findOne({ reset_token: token, reset_token_expires: { $gt: oneHourAgo } }, (err, user) => {
        if (err || !user) {
            return res.render('login', { 
                messages: { error: 'Link de recuperação inválido ou expirado' }
            });
        }
        
        res.render('reset-password', { token, messages: {} });
    });
});

// Rota para processar redefinição de senha
app.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
        return res.render('reset-password', { 
            token,
            messages: { error: 'As senhas não coincidem' }
        });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 8);
        
        const result = await User.findOneAndUpdate(
            { reset_token: token },
            { 
                $set: {
                    password: hashedPassword
                },
                $unset: {
                    reset_token: 1,
                    reset_token_expires: 1
                }
            }
        ).lean();

        if (!result) {
            return res.render('reset-password', { 
                token,
                messages: { error: 'Token inválido ou expirado' }
            });
        }
        
        res.render('login', { 
            messages: { success: 'Senha redefinida com sucesso! Você já pode fazer login.' }
        });
    } catch (error) {
        console.error('Erro ao redefinir senha:', error);
        res.render('reset-password', { 
            token,
            messages: { error: 'Erro ao redefinir senha' }
        });
    }
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

// Tratamento para rotas não encontradas
app.use((req, res) => {
    res.status(404).render('error', { error: 'Página não encontrada' });
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Fechar o servidor graciosamente
    server.close(() => {
        process.exit(1);
    });
}); 