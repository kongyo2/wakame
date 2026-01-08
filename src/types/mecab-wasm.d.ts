declare module 'mecab-wasm' {
    interface MecabToken {
        word: string;
        pos: string;
        pos_detail1: string;
        pos_detail2: string;
        pos_detail3: string;
        conjugation1: string;
        conjugation2: string;
        dictionary_form: string;
        reading: string;
        pronunciation: string;
    }

    interface Mecab {
        waitReady(): Promise<void>;
        query(text: string): MecabToken[];
    }

    const mecab: Mecab;
    export default mecab;
}
