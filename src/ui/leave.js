// Deixa um elemento SAIR da tela antes de ser destruído.
//
// Dois usos hoje: a linha de despesa ao excluir, e o sheet ao fechar. Sem
// isto, os dois simplesmente deixam de existir — o usuário não vê o que
// aconteceu, só o resultado.
//
// O ponto delicado NÃO é a animação, é a garantia: o `depois` (que apaga o
// dado, ou limpa o modal) tem que rodar EXATAMENTE UMA VEZ. Zero vezes deixaria
// o app travado achando que fez; duas vezes faria em dobro. Dá pra errar dos
// dois lados:
//   · `animationend` não dispara com a aba em segundo plano, nem se o elemento
//     for removido por outro render no meio do caminho → precisa de timeout;
//   · com timeout E evento, os dois podem disparar → precisa de trava.
// Por isso isto é um módulo com teste, e não quatro linhas soltas no handler.

export const createLeave = ({ setTimeout: agendar, clearTimeout: cancelar }) =>
  (elementos, { duracao, classe = 'leaving', folga = 60 } = {}, depois) => {
    const alvos = [].concat(elementos || []).filter(Boolean);

    // Nada pra animar, ou movimento desligado (duracao 0 vem do
    // prefers-reduced-motion): acontece na hora, sem cerimônia.
    if (alvos.length === 0 || !(duracao > 0)) { depois(); return; }

    let feito = false;
    let timer = null;
    const fim = () => {
      if (feito) return;
      feito = true;
      if (timer !== null) cancelar(timer);
      depois();
    };

    for (const el of alvos) {
      el.classList.add(classe);
      // `animationend` BORBULHA. Sem filtrar pelo alvo, a animação de qualquer
      // descendente encerraria a saída antes da hora — no sheet isso importa,
      // porque a animação é declarada no backdrop E no .sheet dentro dele.
      //
      // Sem `{ once: true }` de propósito: o `once` gasta a inscrição no
      // primeiro evento QUE CHEGA, inclusive num que o filtro descarta — aí a
      // saída perderia o evento certo e cairia sempre no timeout. Chamar `fim`
      // várias vezes é inofensivo (ele tem trava); perder o evento não é.
      el.addEventListener('animationend', (e) => {
        if (e && e.target && e.target !== el) return;
        fim();
      });
    }
    // Os elementos animam juntos e com a mesma duração, então o primeiro
    // animationend já vale por todos.
    timer = agendar(fim, duracao + folga);
  };
