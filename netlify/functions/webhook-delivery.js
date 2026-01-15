const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MercadoPagoConfig, Payment } = require('mercadopago');

exports.handler = async function(event) {
  console.log("🔔 WEBHOOK CHAMADO!"); // Log para rastreio
  
  try {
    // Inicializa as ferramentas
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const resend = new Resend(process.env.RESEND_API_KEY);
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const payment = new Payment(client);

    // 1. Tenta descobrir o ID do pagamento (pode vir na URL ou no Corpo)
    const queryParams = event.queryStringParameters;
    let paymentId = queryParams?.id || queryParams?.['data.id'];
    
    if (!paymentId && event.body) {
        try {
            const body = JSON.parse(event.body);
            paymentId = body?.data?.id || body?.id;
        } catch(e) {
            console.log("Erro ao ler body JSON", e);
        }
    }

    if (!paymentId) {
        return { statusCode: 200, body: 'Ignorado: Sem ID de pagamento.' };
    }

    // 2. Pergunta ao Mercado Pago o status real desse ID
    const paymentData = await payment.get({ id: paymentId });
    console.log(`💳 Status do Pagamento ${paymentId}: ${paymentData.status}`);
    
    // SÓ processa se estiver Aprovado
    if (paymentData.status === 'approved') {
        const productId = paymentData.external_reference;
        const customerEmail = paymentData.payer.email;
        
        console.log(`📦 Preparando entrega do Produto ${productId} para ${customerEmail}`);

        // 3. Verifica se já não entregamos essa venda antes (Evita duplicidade)
        const { data: existingSale } = await supabase
            .from('sales')
            .select('id')
            .eq('payment_id', String(paymentId))
            .maybeSingle();

        if (existingSale) {
            console.log("⚠️ Venda já processada anteriormente.");
            return { statusCode: 200, body: 'Já processado.' };
        }

        // 4. Busca os detalhes da apostila no banco
        const { data: product } = await supabase
            .from('products')
            .select('*')
            .eq('id', productId)
            .single();

        if (!product) throw new Error('Produto não encontrado no banco.');

        // 5. Salva a venda na tabela 'sales'
        const { error: saleError } = await supabase.from('sales').insert({
            payment_id: String(paymentId),
            customer_email: customerEmail,
            product_id: productId,
            amount: paymentData.transaction_amount, // Agora a coluna existe!
            status: 'approved'
        });

        if (saleError) throw new Error('Erro ao salvar venda: ' + saleError.message);

        // 6. Gera o Link de Download (Válido por 7 dias)
        const { data: signedUrlData, error: urlError } = await supabase
            .storage
            .from('apostilas')
            .createSignedUrl(product.pdf_filename, 604800);

        if (urlError) throw new Error('Erro URL PDF: ' + urlError.message);

        console.log("📧 Enviando E-mail Oficial...");

        // 7. Envia o E-mail via Resend
        await resend.emails.send({
            // REMETENTE: Seu subdomínio verificado (para não cair no spam)
            from: 'Feltro Fácil <nao-responda@loja.feltrofacil.com.br>',
            
            // DESTINATÁRIO: O cliente
            to: [customerEmail],
            
            // RESPOSTA: Se o cliente responder, vai para o seu Gmail pessoal
            reply_to: 'feltrofacil@gmail.com', 
            
            subject: `Sua apostila chegou! 🎁 - ${product.title}`,
            html: `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px; background-color: #fcf7fd;">
                    <div style="text-align: center; margin-bottom: 30px;">
                       <h1 style="color: #660066; margin: 0;">Pagamento Confirmado!</h1>
                       <p style="color: #666; font-size: 16px;">Sua compra foi aprovada com sucesso.</p>
                    </div>
                    
                    <p>Olá,</p>
                    <p>Muito obrigado por adquirir a apostila <strong>${product.title}</strong>.</p>
                    <p>Seu material já está pronto para download. Basta clicar no botão abaixo:</p>
                    <br>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${signedUrlData.signedUrl}" style="background-color: #660066; color: white; padding: 18px 35px; text-decoration: none; border-radius: 50px; font-weight: bold; font-size: 16px; display: inline-block; box-shadow: 0 4px 6px rgba(102, 0, 102, 0.2);">
                            BAIXAR APOSTILA AGORA ⬇️
                        </a>
                    </div>
                    
                    <p style="font-size: 14px; color: #555;">
                        <strong>Dica:</strong> Recomendamos baixar o arquivo em um computador para melhor visualização, mas ele também funciona no celular.
                    </p>
                    
                    <br><br>
                    <hr style="border: 0; border-top: 1px solid #e5e5e5;">
                    
                    <div style="font-size: 12px; color: #888; text-align: center; margin-top: 20px;">
                        <p>Link de download válido por 7 dias.</p>
                        <p>
                            Este é um e-mail automático enviado por <em>nao-responda@loja.feltrofacil.com.br</em>.<br>
                            Se precisar de suporte, basta responder a este e-mail que você será redirecionado para nosso atendimento humano ou escreva para <strong>wilsonglopes@gmail.com</strong>.
                        </p>
                        <p style="margin-top: 20px;">&copy; 2026 Feltro Fácil • Apostilas Digitais</p>
                    </div>
                </div>
            `
        });
        
        console.log("✅ Ciclo completo com sucesso!");
        return { statusCode: 200, body: 'Sucesso' };
    }

    return { statusCode: 200, body: 'Status não aprovado.' };

  } catch (error) {
    console.error('❌ ERRO NO WEBHOOK:', error);
    return { statusCode: 500, body: error.message };
  }
};
