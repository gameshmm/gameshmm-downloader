# Changelog

Formato: cada versão nova adiciona uma seção `## versão - título curto` com os itens em lista.
A seção da versão instalada aparece automaticamente para o usuário na primeira vez que ele abre
essa versão (ver `getChangelogUpdateIfAny` em `main.js`).

## 2.14.1 - Edição Especial de Halloween 🎃

- **Tema Festivo de Halloween**: o app ganha um visual temático temporário em laranja abóbora, roxo bruxa e verde espectral, com efeito cósmico e sutis decorações animadas de Halloween.
- **Temporário e Automático**: ativo automaticamente durante a temporada de Halloween (de 24 de outubro a 2 de novembro) e volta ao normal sozinho após o período, sem você precisar mexer em nada.
- **Controle em Configurações**: novo interruptor em **Configurações → Aparência** para alternar o tema de Halloween a qualquer momento ou manter no modo automático.

## 2.14.0 - FFmpeg resiliente, miniatura em vídeos, ação ao concluir fila e novidades no histórico

- **FFmpeg resiliente com detecção automática**: o app agora detecta automaticamente o FFmpeg do sistema (instalado no PATH) ou cópia personalizada em `%APPDATA%\gameshmm-downloader\bin` caso o binário embutido seja excluído ou bloqueado pelo antivírus. O card de Status do sistema agora exibe a versão real do FFmpeg instalada e sua procedência.
- **Embutir miniatura em vídeos**: nova opção em **Configurações → Opções de download** para embutir a capa oficial diretamente nos metadados de vídeos baixados em MP4 e MKV (além dos áudios MP3).
- **Ação ao concluir a fila**: na aba Fila, você pode escolher o que fazer ao finalizar todos os downloads — "Não fazer nada", "Suspender PC" ou "Desligar PC". Ideal para quem deixa grandes lotes baixando durante a noite.
- **Histórico com cópia rápida e filtro por tipo**: novo botão de 1 clique para copiar o link original de qualquer download já realizado e filtro rápido para alternar entre "Todos", "Só Vídeos" e "Só Áudios" na listagem.
- **Dependências atualizadas**: atualizado `electron` para a versão `41.10.7` (eliminando vulnerabilidades de segurança do Chromium/Electron), `electron-builder` para `26.15.3` e `youtube-dl-exec` para `3.1.17`.

## 2.13.0 - Perfis de download

- **Perfis de download**: na aba Download, logo acima do formato, ficam chips com combinações prontas — "Full HD MP4", "Máxima MKV", "720p leve" e "MP3 320k". Um clique ajusta formato, qualidade, contêiner e qualidade do áudio de uma vez.
- **Salvar atual**: monte suas opções (incluindo legendas e SponsorBlock) e clique em "Salvar atual" pra guardar como um perfil seu, com o nome que quiser. Os perfis ficam salvos junto das configurações, têm um X pra apagar (com "Desfazer") e o perfil marcado se desmarca sozinho quando você mexe em qualquer controle.
- Se o vídeo não tem a resolução do perfil (ex.: perfil 1080p em um vídeo de 720p), o app usa a maior resolução que existir.

## 2.12.1 - Layout novo em todas as abas

- **Todas as abas no layout novo**: Download, Conversor, Fila, Histórico e Config agora seguem o mesmo visual — cartões com ícone, controles deslizantes, etiquetas de status e miniaturas coloridas por site. Nenhuma função foi removida.
- **Aba Download redesenhada**: campo de link grande com faixa de plataformas, estado vazio ilustrado, preview com controle Vídeo/Áudio, slider de qualidade com tamanho estimado no botão ("Baixar MP4 · 1080p · ~148 MB"), contêiner (MP4 ou MKV), interruptores de legendas e SponsorBlock e progresso grande em porcentagem.
- Novas resoluções 1440p e 4K, canal e visualizações no preview, e **Ctrl+V em qualquer lugar da janela** já cola o link e busca.
- **Conversor**: solte um arquivo em qualquer lugar da janela pra abrir, veja a "saída estimada" antes de converter, qualidade em 3 opções e bitrate em slider. Presets, corte, tamanho alvo e GPU continuam iguais.
- **Progresso igual ao da demonstração**: ao baixar ou converter, o formulário some e ficam só a barra listrada com brilho, a porcentagem grande e os cartões de velocidade / restante / baixado (ou saída, na conversão). Ao terminar aparece a tela de "concluído" com o check animado e os botões "Abrir pasta" e "Baixar outro".
- **Qualidade do áudio**: ao baixar em MP3 dá pra escolher 128, 192, 256 ou 320 kbps, com o tamanho estimado.
- **Seletor de qualidade do vídeo** agora mostra todas as resoluções que o vídeo realmente tem (144p, 240p, 360p... até a maior), em vez de uma lista fixa.
- **Config**: atalhos no topo pra pular de seção, cor de destaque em slider e uma barra "alterações não salvas" pra você lembrar de salvar.

## 2.12.0 - Visual novo: roxo, fontes locais e cor por plataforma

- Interface redesenhada, sem mudar nenhuma função: roxo como cor da marca, fundo com malha de cor animada e granulado, cards com brilho que segue o mouse, botões e barras de progresso com brilho.
- A interface **ganha a cor da plataforma** do link colado (YouTube vermelho, Spotify verde, TikTok rosa...) só na aba Download; nas outras abas volta ao roxo. Dá pra desligar em **Config → Aparência**, onde também dá pra trocar a cor da marca (roxo, rosa, azul, verde, laranja).
- Abas com indicador que desliza e transição direcional entre elas; os menus de seleção (qualidade, codec...) e os interruptores foram redesenhados.
- As fontes agora vão **dentro do app** (Geist, Bricolage Grotesque e JetBrains Mono): não depende mais do Google Fonts, então o app fica igual mesmo sem internet.
- O progresso do download/conversão aparece também **no ícone do app na barra de tarefas** do Windows.
- Novas opções em Config → Aparência: fundo animado (liga/desliga) e reduzir animações. O app também respeita "Efeitos de animação" desligado no Windows.
- Extensão (1.5.0, Chrome/Edge e Firefox): o botão "Baixar este vídeo" e o popup usam o roxo do app em vez do verde, e o botão brilha na cor do site (YouTube, TikTok, Instagram, X, Spotify). Recarregue a extensão pra ver.

## 2.11.5 - Download parava ao mandar outro vídeo pela extensão

- Corrigido: com um download em andamento, clicar no botão da extensão pra baixar outro vídeo escondia o card de progresso e zerava a barra do download atual (o download continuava por baixo, mas a tela parecia travada, o botão ficava desabilitado e o "concluído" não aparecia). Agora, se já houver um download rodando (vídeo, playlist ou Spotify), o link enviado pela extensão vai direto pra fila e a tela do download atual não é mexida.

## 2.11.4 - Playlist na fila não mostrava nome nem quantidade de vídeos

- Link de playlist adicionado na fila aparecia só com a URL crua ("https://youtube.com/playlist?list=...") em vez do nome, e sem dizer quantos vídeos tinha — `addLinksToQueue` enfileira rápido de propósito (pra colar vários links não travar a UI) e nunca buscava esses dados. Agora, ao detectar que o link é uma playlist do YouTube, o app busca nome e quantidade em segundo plano e atualiza o item assim que a resposta chega (a fila continua funcionando normalmente enquanto isso). Também busca de novo pra qualquer item de playlist que reabrir sem nome (fila salva de uma versão antiga, ou fechada antes da resposta chegar).

## 2.11.3 - "Requested format is not available" no YouTube (desafio de JavaScript)

- Desde meados de 2026 o YouTube passou a exigir resolver um desafio em JavaScript (o parâmetro "n") pra liberar a maioria dos formatos de vídeo — sem isso, quase tudo "cai" e sobra só imagem, o que aparecia como o erro genérico "Requested format is not available", sem explicar o motivo. Isso podia acontecer mesmo depois de conectar a conta (ex: logo após resolver o vídeo de membros).
- O app agora detecta sozinho se tem Node.js 22+ instalado no PC e, se tiver, passa `--js-runtimes node` pro yt-dlp pra ele usar. O yt-dlp também tenta usar o Deno automaticamente se ele estiver instalado (não precisa de nada extra do app pra isso).
- Mensagem de erro nova explicando o problema e como resolver (instalar Deno ou Node.js 22+) quando nenhum dos dois está disponível.

## 2.11.2 - Vídeo exclusivo de membros não tentava o login

- Corrigido: vídeos exclusivos para membros do canal (erro "This video is available to this channel's members...") não disparavam a tentativa automática com a conta conectada — só "Sign in", "Private" e restrição de idade eram reconhecidos como "precisa de login". Agora esse erro também entra no retry automático com cookies, tanto ao carregar o vídeo quanto no download (único e playlist).
- Mensagem de erro específica quando o vídeo é de membros: avisa pra conectar a conta certa, ou, se já tiver uma conectada, avisa que ela pode não ser a conta inscrita nesse canal.

## 2.11.1 - yt-dlp embutido atualizado

- O yt-dlp que vem dentro do instalador foi atualizado da versão que estava empacotada desde abril para a **2026.08.19**, a mais recente. Isso vale pra quem instala do zero: quem já usa o app continua podendo atualizar sozinho em Configurações, sem administrador. Vários dos erros esquisitos do YouTube (403, "Sign in to confirm...", formatos sumindo) são só o yt-dlp atrasado em relação a uma mudança recente do site.
- O arquivo baixado foi conferido pelo checksum SHA-256 publicado oficialmente pelo projeto yt-dlp antes de entrar no pacote.

## 2.11.0 - Legendas, SponsorBlock, fila cancelável e uma leva de correções

**Recursos novos** (aba Configurações → "Opções de download", valem pro download único, pra fila e pra playlist)
- **Legendas**: baixar embutidas no vídeo ou salvas em .srt ao lado, escolhendo os idiomas e se aceita as legendas automáticas do YouTube quando não existe legenda oficial.
- **SponsorBlock**: pular automaticamente os trechos de publicidade (e, se quiser, intro, fim e autopromoção) marcados pela comunidade. Só no YouTube, e deixa o download um pouco mais lento porque o arquivo precisa ser recortado depois.
- **Capítulos e informações do vídeo** gravados no arquivo, então o player mostra os capítulos do YouTube.
- **Nome do arquivo configurável**: título, canal - título, data - título, ou título [id]. A opção com o id evita que dois vídeos de mesmo título gravem por cima um do outro.
- Playlists agora têm o mesmo resgate de erro 403 que o download único já tinha: tenta de novo com o seu login e depois em 1080p, em vez de marcar o vídeo como ignorado na primeira negativa.
- "Ver formatos" passou a funcionar em vídeo com restrição de idade quando você está conectado.

**Correções**
- **Presets do conversor não funcionavam**: o botão "Salvar" abria uma caixa de texto que o Electron não implementa, então não acontecia nada. Agora tem uma janela de verdade pra dar o nome.
- **Estado do vídeo anterior grudava na tela**: buscar um vídeo novo depois de baixar um mostrava o card já com "Download concluído!" e um botão "Abrir Pasta" que abria a pasta do vídeo anterior. A lista de resoluções também continuava sendo a do vídeo antigo — e "Usar Formato" mandava um código inexistente, fazendo o download falhar. O botão "ver formatos" agora aparece só onde ele realmente funciona (YouTube).
- **Rodar a fila bagunçava a barra da tela principal**: o progresso de todos os downloads paralelos era escrito na mesma barra do download único.
- **Botões travados pra sempre**: se algo desse errado na comunicação interna do app, o botão de baixar/converter ficava desabilitado e "Cancelar" apontava pra um download que já não existia — só reiniciando o app pra sair disso.
- **Cancelar um download do Spotify** mostrava um erro vermelho logo depois do cancelamento, e as faixas paralelas ficavam congeladas na tela. A barra também nunca ficava vermelha por causa de uma regra de estilo.
- **Playlist pulava vídeos em silêncio** quando o yt-dlp não conseguia nem iniciar (antivírus, por exemplo): um item podia ser processado duas vezes e a lista inteira era drenada sem mensagem nenhuma. Agora esse caso mostra a explicação certa.
- **Atualização do app ficava presa** depois de qualquer download do Spotify: um controle interno nunca era liberado, e o app usava justamente ele pra saber que podia instalar a atualização com segurança.
- **Downloads continuavam rodando depois de fechar o app** — yt-dlp e ffmpeg não morrem junto com a janela no Windows, então um download seguia escrevendo arquivo enquanto o instalador de uma atualização trocava os arquivos do programa.
- Um download que terminava bem podia ser reportado como erro se o histórico não pudesse ser gravado; e falhas ao gravar configurações/cookies podiam derrubar o app em silêncio.
- Erro de "não consegui nem iniciar o yt-dlp" agora recebe a explicação sobre antivírus e o atalho pra Segurança do Windows, como os outros erros já tinham.

**Fila**
- **Cancelar fila** de verdade: interrompe o que está baixando e tira o resto da fila. Antes, uma fila iniciada por engano não tinha saída a não ser fechar o app.
- **Limpar** agora pede confirmação e oferece "Desfazer" por alguns segundos — a fila fica salva em disco e pode ter sido montada ao longo do dia.
- O campo de links virou multilinha de verdade e Enter adiciona; links repetidos são ignorados em vez de virarem dois downloads gravando o mesmo arquivo.
- O contador na aba conta só o que falta (antes continuava marcando o total mesmo com tudo concluído) e a barra de cada item deixou de pular aos saltos.

**Interface**
- O app agora se adapta a janelas estreitas em vez de espremer/estourar os controles.
- Foco visível ao navegar por Tab (não havia nenhum), Esc e clique fora fechando os modais, avisos anunciáveis por leitor de tela e área de clique maior nos botões pequenos.
- Texto secundário com mais contraste, toasts com botão de fechar, e o cursor já começa no campo de link ao abrir o app.
- O seletor de pasta abre na última pasta usada, o histórico manda o item pra aba Fila direto, e trocar de arquivo no conversor limpa o corte e o tamanho-alvo do arquivo anterior (que antes eram aplicados em silêncio no arquivo novo).
- Links do protocolo customizado agora são validados: só http/https, e o endereço nunca pode ser interpretado como opção de linha de comando.

## 2.10.0 - Atualização do yt-dlp sem administrador, extensão funcionando com o app elevado, status do sistema e fila melhor
- **Corrigido: "Verificar Atualização" do yt-dlp dava erro quando o app não estava aberto como administrador.** A atualização era feita com `yt-dlp -U`, que reescreve o próprio programa dentro da pasta de instalação — escrita que o Windows nega pra um app comum. Agora o app baixa a versão oficial mais recente direto do GitHub pra uma pasta dele mesmo (dentro de %APPDATA%) e passa a usar essa cópia: funciona sem administrador, mostra o progresso do download e confere se o arquivo baixado realmente roda antes de trocar. O botão agora também diz qual versão está instalada e de onde ela veio.
- **Corrigido: a extensão do navegador não conectava quando o app estava aberto como administrador.** Ao clicar no botão da extensão, o Windows abre uma segunda cópia do app que deveria repassar o link (ou os cookies de login) pra que já está rodando — e esse repasse é feito por uma mensagem entre janelas que o Windows bloqueia quando o destino é um programa elevado. Resultado: o clique morria em silêncio. O repasse agora é feito por um arquivo dentro da pasta de dados do app, que os dois lados enxergam igual, elevado ou não.
- **Novo card "Status do sistema" em Configurações**: versão do yt-dlp em uso (e se é a cópia atualizada pelo app ou a do instalador), ffmpeg, estado do login, quando a extensão falou com o app pela última vez e a versão do app. Se o app estiver aberto como administrador, aparece um aviso explicando que não é necessário — com um botão "Reabrir normal" que reabre sem elevação.
- **Limite de velocidade por download** (Configurações): útil pra baixar em segundo plano sem engasgar o resto da internet. Vazio ou 0 = sem limite.
- **Fila**: agora fica salva em disco — fechar o app não perde mais o que estava esperando. Dá pra pausar/retomar (os downloads em andamento terminam, os próximos aguardam), reordenar arrastando os itens, repetir de uma vez todos os que falharam e ver a mensagem de erro no próprio item.
- **Histórico**: novo botão pra mandar qualquer item de volta pra fila — tanto pra repetir um download que falhou quanto pra baixar de novo algo que já deu certo.
- Correções menores: a barra de progresso da fila calculava a porcentagem sobre a fila inteira (incluindo itens já concluídos em rodadas anteriores) e travava antes dos 100%; o log da atualização do yt-dlp repetia cada linha uma vez a mais a cada nova tentativa; títulos com caracteres como `<` e `&` quebravam a exibição na fila e no histórico; e salvar a tela de Configurações não pode mais apagar dados que o app guarda sozinho no mesmo arquivo.

## 2.9.3 - Aviso de yt-dlp desatualizado e detecção de vídeo repetido
- O app agora checa sozinho, em segundo plano (ao abrir e a cada 24h), se existe uma versão mais nova do yt-dlp — sem atualizar sozinho, só avisa: aparece um "!" na aba Config e uma nota explicando junto do botão "Verificar Atualização".
- Antes de baixar um vídeo único, o app avisa se você já baixou esse mesmo link com sucesso antes (mostrando quando e onde foi salvo), com a opção de baixar de novo mesmo assim ou cancelar. Por enquanto vale só pro botão "Baixar" da tela principal — itens adicionados direto na fila/playlist não passam por essa checagem, pra não travar um lote grande esperando resposta a cada item repetido.

## 2.9.2 - Fallback automático pro erro 403 em qualidade máxima
- Alguns vídeos (não todos) davam "Acesso negado (403)" ao baixar em "Máxima Possível" — o YouTube passou a exigir um token especial para liberar os formatos de resolução mais alta (ex: 4K), que o yt-dlp não consegue gerar sozinho, mesmo atualizado. Agora, quando isso acontece, o app tenta de novo automaticamente antes de mostrar erro pro usuário: primeiro na mesma qualidade mas usando o login conectado (se houver — contas logadas às vezes liberam formatos que, sem sessão, exigiriam o tal token), e só se ainda assim falhar, cai pra 1080p (que normalmente não exige o token).
- Mensagem de erro do 403 mais clara, explicando a causa e sugerindo tentar uma qualidade menor ou fazer login em "Conectar".

## 2.9.1 - Correção: MP3 na fila baixando como MP4
- Corrigido um problema em que colar vários links na fila e só depois trocar pra MP3 (ou mudar a qualidade) não tinha efeito nos links que já estavam na lista — eles baixavam em MP4 mesmo com MP3 selecionado, porque o formato era travado no momento em que o link entrava na fila. Agora, itens adicionados colando links ou pelo botão "+" acompanham o formato/qualidade selecionados até começarem a baixar.

## 2.9.0 - Extensão para Firefox
- Nova versão da extensão do navegador feita especialmente pro Firefox (a versão anterior só funcionava em navegadores baseados em Chromium, como Chrome e Edge). Mesmos botões de download e o "Conectar ao app" pro login do YouTube.
- Em Configurações > Extensão do navegador, novo botão "Abrir pasta da extensão (Firefox)" com o passo a passo de instalação (carregamento temporário via about:debugging, e como assinar pela Mozilla pra instalação permanente).

## 2.8.1 - Ajustes finos do login pela extensão
- O botão "Conectar ao app" (na página do youtube.com) some sozinho depois que você conecta, pra não ficar no caminho. Se desconectar no app e quiser reconectar, tem um link "mostrar o botão de novo" no popup da extensão.
- Reduzido bastante o tamanho dos dados enviados pro app: agora só manda os cookies de sessão/login de verdade (SID, LOGIN_INFO e variantes), em vez de todos os cookies de google.com — o excesso de cookies irrelevantes (analytics, anúncios, consentimento) estava inflando o link e causando falha silenciosa na entrega pro app.
- Removida a instrumentação de log temporária usada pra depurar esse fluxo.

## 2.8.0 - Login pela extensão do navegador
- "Conectar" agora orienta a fazer login pela extensão do navegador: na página do youtube.com aparece um botão roxo "Conectar ao app", fixo no canto da tela — em vez do app ler os cookies do navegador instalado no PC diretamente. A extensão lê os cookies de dentro do próprio navegador, já logado, e manda pro app — isso evita dois problemas comuns: o Chrome (versão 127 em diante) passou a bloquear a leitura de cookies por qualquer programa externo mesmo rodando como administrador, e alguns antivírus (Windows Defender incluso) sinalizavam a cópia do banco de cookies do navegador como comportamento suspeito. Se você já tinha a extensão instalada, recarregue ela em chrome://extensions (ela pede permissões novas) pra pegar essa novidade.
- Tentamos antes uma janela de login dentro do próprio app, mas o Google bloqueia esse tipo de login com "Esse navegador ou app pode não ser seguro" — por isso a extensão, que usa o navegador de verdade do usuário.
- O método antigo (ler cookies direto de um navegador instalado pelo app) continua disponível como alternativa em "Outro método", pra quem não usa a extensão.
- Novo botão "Sair" pra desconectar quando quiser trocar de conta.
- Mensagens de erro mais claras quando um download falha por possível bloqueio de antivírus, com atalho pra abrir a tela de Segurança do Windows direto do app.

## 2.7.1 - Visual das configurações
- Os três interruptores de Configurações (detectar links, bandeja, atalho global) estavam com uma borda azul acesa pesada demais — trocados por um visual mais limpo, de lista com interruptor, igual o resto do app.

## 2.7.0 - Seleção de playlist, presets, busca no histórico, bandeja e mais
- Playlist: agora dá pra marcar quais vídeos baixar em vez de sempre baixar tudo — a numeração dos arquivos respeita a posição original mesmo pulando alguns.
- Conversor: presets — salve a combinação de formato/codec/qualidade atual com um nome (ex: "Instagram Story") e aplique de novo depois com um clique.
- Histórico: busca por título/link e filtro por status (sucesso/erro) e por origem (YouTube, Spotify, TikTok...).
- Bandeja do sistema: o app agora pode ficar rodando na bandeja em vez de fechar de vez (dá pra desativar em Configurações). Um aviso explica na primeira vez que isso acontece.
- Atalho global (Ctrl+Shift+D): copie um link suportado em qualquer lugar e pressione o atalho pra abrir o app com o link já preenchido e buscado — também dá pra desativar em Configurações.
- Fila: agora dá pra colar vários links de uma vez (um por linha, ou separados por espaço/vírgula) e todos entram na fila juntos.

## 2.5.1 - Correção do botão no Spotify
- Corrigido: o botão da extensão não aparecia em algumas páginas do Spotify (álbuns, músicas etc. com URL tipo "/intl-pt/album/..."), porque o idioma/região no link não estava sendo reconhecido. Se você já tinha carregado a extensão, é só recarregar ela em chrome://extensions (ícone de atualizar no card dela) pra pegar a correção.

## 2.5.0 - Extensão em mais sites
- O botão "Baixar" da extensão agora também aparece no TikTok, X/Twitter (na página do post), Instagram (reels/posts) e Spotify — antes era só YouTube.
- A extensão funciona em qualquer navegador baseado em Chromium (Chrome, Edge, Brave, Opera...), instalando do mesmo jeito.

## 2.4.1 - Instalação da extensão pelo app
- Nova seção em Configurações: "Extensão do navegador", com passo a passo pra instalar (a extensão ainda não está nas lojas) e um botão que já abre a pasta certa da extensão pra você selecionar no Chrome/Edge.

## 2.4.0 - Extensão do navegador
- Nova extensão pra Chrome/Edge (pasta "extension" ao lado do app): coloca um botãozinho no canto do vídeo do YouTube pra mandar o download direto pro app, sem precisar copiar e colar o link.
- O botão some clicando no "✕" dele (dá pra reativar no ícone da extensão), e também dá pra desligar tudo pelo popup da extensão.
- O app agora abre e recebe links vindos da extensão automaticamente, e foca a janela sozinho se já estiver aberto.

## 2.3.0 - Informações do arquivo no conversor
- Ao escolher um arquivo no Conversor, o app agora mostra formato, codec de vídeo (com resolução e fps), codec de áudio, duração e tamanho do arquivo escolhido.

## 2.2.3 - Changelog acumulado
- A tela de novidades agora mostra TODAS as versões que você ainda não viu, não só a mais recente — se você pulou várias atualizações de uma vez (ex: estava na 2.1.0 e atualizou direto pra 2.2.2), aparece o changelog de cada versão intermediária.

## 2.2.2 - Correção de tamanho no conversor AV1/VP9
- Corrigido: converter para AV1 ou VP9 podia gerar um arquivo MAIOR que o original. O nível de "Qualidade" (Alta/Padrão/Menor) usava o mesmo número pra todos os codecs, mas H.264, VP9 e AV1 têm escalas de qualidade diferentes — agora cada codec usa o valor certo pra essa escala.

## 2.2.1 - Correção de arquivo corrompido no conversor
- Corrigido: quando uma conversão falhava ou era cancelada, o arquivo de saída incompleto ficava salvo na pasta (podendo dar erro "moov atom not found" se você tentasse abrir ou converter ele depois). Agora esse arquivo quebrado é apagado automaticamente.

## 2.2.0 - Corte, tamanho-alvo, capa nos MP3s e detecção de links
- Conversor: corte de vídeo/áudio por tempo (início/fim), opcional, funciona em qualquer conversão.
- Conversor: "Tamanho alvo (MB)" — informe o tamanho desejado e o app calcula o bitrate sozinho pra caber nele, tanto em vídeo quanto em áudio.
- MP3s baixados agora vêm com a capa do álbum e os metadados (título/artista) embutidos, então aparecem certinho no tocador de música — inclusive os baixados pelo Spotify, usando a capa real do álbum.
- Detecção de link copiado: se você copiar um link suportado (YouTube, Spotify, TikTok...), o app avisa e oferece colar e buscar automaticamente. Dá pra desativar em Configurações.
- Corrigido: salvar as Configurações estava apagando o restante das configurações salvas (como o login do YouTube) em vez de só atualizar a pasta padrão.

## 2.1.0 - Conversor de mídia
- Nova aba Converter: transforme vídeos entre formatos (MP4, MKV, WebM, AVI, MOV) e codecs (H.264, H.265, VP9, AV1), ou extraia/converta para áudio (MP3, WAV, FLAC, AAC, OGG).
- Trava de segurança: não é mais possível tentar converter um arquivo de áudio para vídeo (isso sempre dava erro).
- Aceleração por GPU: quando há uma placa compatível (Nvidia NVENC, AMD AMF ou Intel QSV), o app usa a GPU automaticamente para converter mais rápido, sem precisar configurar nada — se não tiver, cai pra CPU sozinho.
- Novidades: a partir de agora, sempre que uma atualização trouxer mudanças, essa telinha aparece na primeira vez que você abrir a nova versão.
- Atualizações agora reiniciam e instalam sozinhas assim que não há nenhum download ou conversão em andamento — não precisa mais clicar em nada.
- Corrigido: a detecção de GPU para AV1 usava um teste pequeno demais e podia não reconhecer placas compatíveis (ex: RTX série 40).

## 2.0.1 - Atualizações automáticas
- O app agora verifica, baixa e instala novas versões sozinho — sem precisar baixar o instalador de novo manualmente.
- Corrigido: a versão exibida na tela de configurações agora é sempre a real, em vez de um número fixo.

## 2.0.0 - Cookies travados
- Quando o navegador trava os cookies (erro "Feche o navegador..."), o app agora mostra um botão para encerrar o navegador automaticamente em vez de exigir fechar tudo manualmente.
