// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 19543909399809761843560969426728965348131532116939484259087063977014968105827;
    uint256 constant alphay  = 13530082266648507878722092859702941002257463637563234706835498220969601541838;
    uint256 constant betax1  = 14284981436689418355413937803503663839190378970985259975220299166142095275900;
    uint256 constant betax2  = 11941383395273327848034245663447992848198495511807070562033820244592461162531;
    uint256 constant betay1  = 19000852899638687965003568538477516798097365574155688873585739445558037485202;
    uint256 constant betay2  = 7816081640642561799025500231908305567340632767815665724478643963459418287068;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 13360680984938382038171072327362191732879555076191673949946434158992407652376;
    uint256 constant deltax2 = 12240069104605018970969555396408684349368288521228350919321021256110851382381;
    uint256 constant deltay1 = 15442342198268259518508423575848806532159890269974854118791303397612414920304;
    uint256 constant deltay2 = 4376336357667746718344878752157208101941465517238698037432334820709692304995;

    
    uint256 constant IC0x = 20724911116850914324564809088583556655746739441007692838177730749384655830991;
    uint256 constant IC0y = 5631460792280051520931515583480139751500584677655269282343220593401356571206;
    
    uint256 constant IC1x = 243206128938421202804280789653690860773400937825654026535677631933109880248;
    uint256 constant IC1y = 8831581698703069974060368110398681213934197664837307639294802240866738179745;
    
    uint256 constant IC2x = 19321950060664537085756128230298545699761656209403747190081487804901515181751;
    uint256 constant IC2y = 19577765166597793379320183209460193785195544766229505846179123176201261556997;
    
    uint256 constant IC3x = 11689215029472289259924537837138352623783700887930580509463144713222076191191;
    uint256 constant IC3y = 9499964323142132925207373536208594847008121949723237113717960542312592061289;
    
    uint256 constant IC4x = 960978922453382748944870980775242067165953989960147585743742721441936671879;
    uint256 constant IC4y = 7212658215356248234161965570328859309171568499033757184026942005984758208613;
    
    uint256 constant IC5x = 15869460948229606337149224755218697351515704561549225303636191810428279711922;
    uint256 constant IC5y = 15531936758587412438260526627129956182511546414929717512354528206456038466106;
    
    uint256 constant IC6x = 20986208122785593028393164969878742080768990642655306382269743410418336183573;
    uint256 constant IC6y = 20609306477799126644269358202356324369744244770601342809227303829952209831877;
    
    uint256 constant IC7x = 19689569726997080722846385950395261912088684852403539536177352718911824271406;
    uint256 constant IC7y = 10237559174184188099334038671370467524471685951389547925790255871008229077824;
    
    uint256 constant IC8x = 19011514890148861263476633854700034843318980837925249511007511075703143612476;
    uint256 constant IC8y = 9394184392034834621958155365242201911986826682071958983512109350489719452179;
    
    uint256 constant IC9x = 4352371726973647538580747245839561374305249359611595128692586451441328403045;
    uint256 constant IC9y = 12042216321830009066844886444027050368999001289222123454614611147177588387539;
    
    uint256 constant IC10x = 13558109825992630823601686558480648381384406268722089804804536538278152771977;
    uint256 constant IC10y = 6400513749441120818256504844077795635151097465325881257959486313531746064180;
    
    uint256 constant IC11x = 8087834314910260643115802587142965589195351929464327896985524283009896644818;
    uint256 constant IC11y = 2072856992421918954792995316881980861884509131292039955594801537304540777646;
    
    uint256 constant IC12x = 19775529929857649433494283623404759897792616105010115832822514975635115325968;
    uint256 constant IC12y = 6099728445645795756025446041984920280124271942451595919418111356741406267964;
    
    uint256 constant IC13x = 88756641284177496264437116740722106293130306242356202031596180293506752199;
    uint256 constant IC13y = 11305917230222795840038403070953747983872082693856396848370039400229255261113;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[13] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
