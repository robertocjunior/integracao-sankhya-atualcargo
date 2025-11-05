CREATE OR REPLACE TRIGGER TRG_BLOCK_DELETE_AD_LOCATCAR
BEFORE DELETE ON AD_LOCATCAR
BEGIN
    -- Interrompe a operação e retorna uma mensagem de erro customizada.
    RAISE_APPLICATION_ERROR(-20001, 'A exclusão de registros nesta tabela (AD_LOCATCAR) não é permitida.');
END;