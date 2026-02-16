const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { email, productIds } = JSON.parse(event.body);

    if (!email || !productIds || productIds.length === 0) {
      throw new Error('Dados incompletos.');
    }

    // 1. Buscar detalhes dos produtos para saber o preço e nome
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .in('id', productIds);

    if (!products) throw new Error('Produtos não encontrados.');

    // 2. Registrar cada venda no Banco de Dados
    const salesToInsert = products.map(product => ({
      product_id: product.id,
      customer_email: email,
      amount: product.price, // Salva o valor original do produto
      status: 'approved',
      payment_method: 'manual_pix', // Marca como venda manual
      payment_id: `MANUAL_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` // ID fictício
    }));

    const { error: salesError } = await supabase.from('sales').insert(salesToInsert);
    if (salesError) throw salesError;

    // 3. Montar o E-mail com os Links
    const linksHtml = products.map(p => 
      `<li><strong>${p.title}:</strong> <a href="${p.pdf_filename ? 
        supabase.storage.from('apostilas').getPublicUrl(p.pdf_filename).data.publicUrl : '#'
      }">Baixar Arquivo</a></li>`
    ).join('');

    // 4. Enviar o E-mail
    await resend.emails.send({
      from: 'Feltro Fácil <nao-responda@feltrofacil.com.br>', // Use seu remetente configurado
      to: email,
      subject: 'Seus arquivos chegaram! (Compra via Pix/Manual)',
      html: `
        <div style="font-family: sans-serif; color: #333;">
          <h1 style="color: #660066;">Obrigada pela compra!</h1>
          <p>Aqui estão os arquivos que você adquiriu diretamente conosco:</p>
          <ul>${linksHtml}</ul>
          <p>Qualquer dúvida, é só chamar no WhatsApp!</p>
        </div>
      `
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Venda registrada e e-mail enviado!' }),
    };

  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
